import { TransformResult } from 'unplugin';
import { ESTreeMap, Path, walk } from 'astray';
import MagicString, { SourceMap } from 'magic-string';
import requireFromString from 'require-from-string';
import * as path from 'path';
import { fileURLToPath } from 'url';
import * as rollup from 'rollup';
import { parseModule } from 'meriyah';
import { dedent } from './dedent.js';

declare module 'estree' {
  interface BaseNodeWithoutComments {
    start: number;
    end: number;
  }
}

const parse = (code: string) => {
  return parseModule(code, { ranges: true });
};

interface EmitCSS {
  /** Add CSS to the output. Returns a generated class name. */
  (css: string): string;
}
const exportPrefix = '__severed_css_';

const findTopLevelStatement = (
  node: Path<ESTreeMap, ESTreeMap[keyof ESTreeMap]>,
) => {
  let ancestor = node;
  while (ancestor.path?.parent && ancestor.path.parent.type !== 'Program') {
    ancestor = ancestor.path.parent;
  }
  return ancestor;
};

const modifyCodeForEvaluation = (code: string) => {
  const importName = 'css';
  const tree = parse(code);
  const stringForRollup = new MagicString(code);
  const templateLiteralLocations: [number, number][] = [];
  let i = 0;
  walk(tree, {
    ExportNamedDeclaration(node) {
      if (node.declaration) {
        // Export attached to a declaration, e.g. export const foo = bar();
        // -> keep the declaration but get rid of the export (for tree-shaking)
        stringForRollup.remove(node.start, node.declaration.start);
      } else {
        // No declaration, e.g. `export { foo }`
        // -> remove it so it can be tree-shaken before evaluation
        stringForRollup.remove(node.start, node.end);
      }
    },
    ExportAllDeclaration(node) {
      // export * from './foo' or export * as asdf from './foo'
      // -> remove it so it can be tree-shaken before evaluation
      stringForRollup.remove(node.start, node.end);
    },
    ExportDefaultDeclaration(node) {
      // Default export attached to a declaration, e.g. export default function foo() {}
      // -> keep the declaration but get rid of the export (for tree-shaking)
      stringForRollup.remove(node.start, node.declaration.start);
    },
    TaggedTemplateExpression(node) {
      if (node.tag.type === 'Identifier' && node.tag.name === importName) {
        stringForRollup.overwrite(node.start, node.end, "'SEVERED_CSS_HERE'");
        templateLiteralLocations.push([node.start, node.end]);
        const nearestTopLevelStatement = findTopLevelStatement(node);
        const targetLocation =
          nearestTopLevelStatement?.start || tree.body[0].start;
        stringForRollup.prependLeft(
          targetLocation,
          `export const ${exportPrefix}${i} = ${code.slice(
            node.start + importName.length,
            node.end,
          )};\n`,
        );
        i++;
      }
    },
    // Adds /* @__PURE__ */ annotations to all function calls so that rollup can remove them
    // if their return values are not being used.
    CallExpression(node) {
      stringForRollup.prependLeft(node.start, '/* @__PURE__ */ ');
    },
  });
  return {
    code: stringForRollup.toString(),
    templateLiteralLocations,
  };
};

export const transform = async (
  code: string,
  id: string,
  emitCSS: EmitCSS,
): Promise<null | { code: string; map: SourceMap }> => {
  const { code: stringForRollup, templateLiteralLocations } =
    modifyCodeForEvaluation(code);
  if (templateLiteralLocations.length === 0) return null;
  const stringForOutput = new MagicString(code);
  const virtualPrefix = '\0virtual';
  const entryName = `${virtualPrefix}:entry`;
  const innerName = `${virtualPrefix}:inner`;
  const build = await rollup.rollup({
    input: innerName,
    plugins: [
      {
        name: 'virtual',
        resolveId(id) {
          if (id.startsWith(virtualPrefix))
            return { id, moduleSideEffects: false };
        },
        load(id) {
          if (id === entryName) return `export * from "${innerName}"`;
          if (id === innerName) return stringForRollup;
        },
      },
    ],
    treeshake: {
      moduleSideEffects: false,
      preset: 'smallest',
    },
    external: (id) => !id.startsWith(virtualPrefix) && /[^./]/g.test(id),
  });
  const { output } = await build.generate({
    format: 'cjs',
  });
  const rollupOutputString = output[0].code;

  let fileExports;
  try {
    fileExports = requireFromString(rollupOutputString, id);
  } catch (error: any) {
    throw new Error(
      `Failed to evaluate \`${id}\` while extracting css: ${error.message}`,
    );
  }
  for (const [exportName, css] of Object.entries(fileExports)) {
    if (exportName.startsWith(exportPrefix)) {
      const exportNum = Number(exportName.slice(exportPrefix.length));
      if (typeof css !== 'string')
        throw new Error('expected css to evaluate to string');
      const className = emitCSS(css);

      const originalLocation = templateLiteralLocations[exportNum];
      stringForOutput.overwrite(
        originalLocation[0],
        originalLocation[1],
        JSON.stringify(className),
      );
    }
  }

  stringForOutput.prepend(`import "${id}.severed.css"\n`);

  return {
    code: stringForOutput.toString(),
    map: stringForOutput.generateMap(),
  };
};

if (import.meta.vitest) {
  const { it, expect, describe, vi } = import.meta.vitest;

  describe('modifyCodeForEvaluation', () => {
    const replaceTemplateLiterals = (
      code: string,
      templateLiteralLocations: [number, number][],
    ) => {
      let output = '';
      let offset = 0;
      let i = 0;
      for (const templateLiteralLocation of templateLiteralLocations) {
        output += code.slice(offset, templateLiteralLocation[0]);
        output += `<${i}>`;
        offset = templateLiteralLocation[1];
        i++;
      }
      return output + code.slice(offset);
    };
    it('replaceTemplateLiterals', () => {
      expect(replaceTemplateLiterals(' asdf ', [[0, 1]])).toMatchInlineSnapshot(
        '"<0>asdf "',
      );
      expect(replaceTemplateLiterals(' asdf ', [[1, 5]])).toMatchInlineSnapshot(
        '" <0> "',
      );
      expect(
        replaceTemplateLiterals(' asdf ', [
          [0, 1],
          [5, 6],
        ]),
      ).toMatchInlineSnapshot('"<0>asdf<1>"');
    });

    it('passes through when there are no results', () => {
      const input = dedent`
        console.log('hi')
      `;
      const modified = modifyCodeForEvaluation(input);
      expect(modified.code).toMatchInlineSnapshot(
        '"/* @__PURE__ */ console.log(\'hi\')"',
      );
      expect(modified.templateLiteralLocations).toStrictEqual([]);
    });

    it('adds export for top-level css declarations', () => {
      const input = dedent`
        css\`foo\`;
        console.log(css\`asdf\`)
        const foo = css\`
          background: \${color}
        \`
      `;
      const modified = modifyCodeForEvaluation(input);
      expect(modified.code).toMatchInlineSnapshot(`
        "export const __severed_css_0 = \`foo\`;
        'SEVERED_CSS_HERE';
        export const __severed_css_1 = \`asdf\`;
        /* @__PURE__ */ console.log('SEVERED_CSS_HERE')
        export const __severed_css_2 = \`
          background: \${color}
        \`;
        const foo = 'SEVERED_CSS_HERE'"
      `);
      expect(replaceTemplateLiterals(input, modified.templateLiteralLocations))
        .toMatchInlineSnapshot(`
          "<0>;
          console.log(<1>)
          const foo = <2>"
        `);
    });

    it('hoists nested css declarations to right above the nearest top-level statement', () => {
      const input = dedent`
        console.log(css\`asdf\`)
        {
          const foo = () => {
            if (h) return css\`background: red\`;
          }
        }
      `;
      const modified = modifyCodeForEvaluation(input);
      expect(modified.code).toMatchInlineSnapshot(`
        "export const __severed_css_0 = \`asdf\`;
        /* @__PURE__ */ console.log('SEVERED_CSS_HERE')
        export const __severed_css_1 = \`background: red\`;
        {
          const foo = () => {
            if (h) return 'SEVERED_CSS_HERE';
          }
        }"
      `);
      expect(replaceTemplateLiterals(input, modified.templateLiteralLocations))
        .toMatchInlineSnapshot(`
          "console.log(<0>)
          {
            const foo = () => {
              if (h) return <1>;
            }
          }"
        `);
    });

    it('throws if there is a parse error', () => {
      const input = dedent`
        console.log(hi))
      `;
      // TODO: improve error message
      expect(() =>
        modifyCodeForEvaluation(input),
      ).toThrowErrorMatchingInlineSnapshot('"[1:16]: Unexpected token: \')\'"');
    });

    it('Removes other exports for tree-shaking', () => {
      const input = dedent`
        export const remove_me = hi();
        export const keep_me = css\`some_css\`;
        const remove = '';
        export {remove, f as default};
        export * as asdf from './other';
        export * from 'other2';
        export default function f() {
          console.log(css\`asdf\`)
        }
      `;
      const modified = modifyCodeForEvaluation(input);
      expect(modified.code).toMatchInlineSnapshot(`
        "const remove_me = /* @__PURE__ */ hi();
        export const __severed_css_0 = \`some_css\`;
        const keep_me = 'SEVERED_CSS_HERE';
        const remove = '';



        export const __severed_css_1 = \`asdf\`;
        function f() {
          /* @__PURE__ */ console.log('SEVERED_CSS_HERE')
        }"
      `);
      expect(replaceTemplateLiterals(input, modified.templateLiteralLocations))
        .toMatchInlineSnapshot(`
          "export const remove_me = hi();
          export const keep_me = <0>;
          const remove = '';
          export {remove, f as default};
          export * as asdf from './other';
          export * from 'other2';
          export default function f() {
            console.log(<1>)
          }"
        `);
    });

    it('Adds /* @__PURE__ */ annotations on potentially-unsafe code', () => {
      const input = dedent`
        const foo = localStorage.getItem('blah')

        const color = 'green'
        const className = css\`
          background: \${color}
        \`
      `;
      const modified = modifyCodeForEvaluation(input);
      expect(modified.code).toMatchInlineSnapshot(`
        "const foo = /* @__PURE__ */ localStorage.getItem('blah')

        const color = 'green'
        export const __severed_css_0 = \`
          background: \${color}
        \`;
        const className = 'SEVERED_CSS_HERE'"
      `);
      expect(replaceTemplateLiterals(input, modified.templateLiteralLocations))
        .toMatchInlineSnapshot(`
        "const foo = localStorage.getItem('blah')

        const color = 'green'
        const className = <0>"
      `);
    });
  });

  it('outputs with single css block', async () => {
    const inputCode = `
      import * as esbuild from 'esbuild'
      let s = esbuild.foo
      const color = 'purple'
      const a = css\`
        background: \${color}
      \`
    `;
    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    const emitCSS = vi.fn(((_css) => {
      return '.fake-className';
    }) as EmitCSS);
    const result = await transform(
      inputCode,
      path.join(__dirname, 'index.ts'),
      emitCSS,
    );
    expect(emitCSS).toHaveBeenCalledTimes(1);
    expect(emitCSS.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "
              background: purple
            ",
        ],
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "code": "import \\"/home/caleb/Programming/calebeby/severed/packages/severed/index.ts.severed.css\\"

            import * as esbuild from 'esbuild'
            let s = esbuild.foo
            const color = 'purple'
            const a = \\".fake-className\\"
          ",
        "map": SourceMap {
          "file": null,
          "mappings": ";AAAA;AACA;AACA;AACA;AACA,gBAAgB,iBAET;AACP",
          "names": [],
          "sources": [
            null,
          ],
          "sourcesContent": [
            null,
          ],
          "version": 3,
        },
      }
    `);
  });

  it('outputs with multiple css block', async () => {
    const inputCode = `
      import * as esbuild from 'esbuild'
      let s = esbuild.foo

      const color = 'purple'
      const b = css\`
        background: \${color}
      \`
      const c = () => {
        if (foo) {
          const s = css\`display: grid\`
        }
      }
    `;
    const __dirname = path.dirname(fileURLToPath(import.meta.url));

    let i = 0;
    const emitCSS = vi.fn(((_css) => {
      const className = `.fake-className-${i}`;
      i++;
      return className;
    }) as EmitCSS);
    const result = await transform(
      inputCode,
      path.join(__dirname, 'index.ts'),
      emitCSS,
    );
    expect(emitCSS).toHaveBeenCalledTimes(2);
    expect(emitCSS.mock.calls).toMatchInlineSnapshot(`
      [
        [
          "
              background: purple
            ",
        ],
        [
          "display: grid",
        ],
      ]
    `);
    expect(result).toMatchInlineSnapshot(`
      {
        "code": "import \\"/home/caleb/Programming/calebeby/severed/packages/severed/index.ts.severed.css\\"

            import * as esbuild from 'esbuild'
            let s = esbuild.foo

            const color = 'purple'
            const b = \\".fake-className-0\\"
            const c = () => {
              if (foo) {
                const s = \\".fake-className-1\\"
              }
            }
          ",
        "map": SourceMap {
          "file": null,
          "mappings": ";AAAA;AACA;AACA;AACA;AACA;AACA,gBAAgB,mBAET;AACP;AACA;AACA,oBAAoB,mBAAkB;AACtC;AACA;AACA",
          "names": [],
          "sources": [
            null,
          ],
          "sourcesContent": [
            null,
          ],
          "version": 3,
        },
      }
    `);
  });

  it('throws if there is an evaluation error in the code needed to evaluate the string', async () => {
    const input = dedent`
      const foo = css\`
        background: \${color}
      \`
    `;
    const msg = await transform(input, 'asdf', () => '').catch(
      (err) => err.message,
    );
    expect(msg).toMatchInlineSnapshot(
      '"Failed to evaluate `asdf` while extracting css: color is not defined"',
    );
  });

  it("does not throw for code that isn't needed for evaluation", async () => {
    const input = dedent`
      // These variables are not defined, but should be tree-shaken
      const foo1 = bar
      const foo2 = bar()
      const foo3 = window.bar()
      const foo4 = window.bar

      const color = 'red'
      const foo5 = css\`
        background: \${color}
      \`
    `;
    const result = await transform(input, 'asdf', (css) => {
      expect(css.trim()).toEqual('background: red');
      return 'className';
    });
    expect(result).toMatchInlineSnapshot(`
      {
        "code": "import \\"asdf.severed.css\\"
      // These variables are not defined, but should be tree-shaken
      const foo1 = bar
      const foo2 = bar()
      const foo3 = window.bar()
      const foo4 = window.bar

      const color = 'red'
      const foo5 = \\"className\\"",
        "map": SourceMap {
          "file": null,
          "mappings": ";AAAA;AACA;AACA;AACA;AACA;AACA;AACA;AACA,aAAa",
          "names": [],
          "sources": [
            null,
          ],
          "sourcesContent": [
            null,
          ],
          "version": 3,
        },
      }
    `);
  });
}
