import { dedent } from './dedent.js';
import { createUnplugin } from 'unplugin';
import { transform } from './transform-file.js';
import * as fs from 'fs/promises';
import * as path from 'path';
import * as stylis from 'stylis';
import * as crypto from 'crypto';
import { fileURLToPath } from 'url';

const hash = (inputs: string[]) => {
  const h = crypto.createHash('sha512');
  for (const input of inputs) h.update(input);
  return h.digest('hex');
};

const suffix = '.severed.css';

export interface PluginOpts {
  /**
   * Whether to write a .severed.css file corresponding to each input file in the output folder.
   * If false (default), other plugins (for example rollup-plugin-css-only)
   * will be responsible for combining the CSS into an output asset and writing it to disk.
   */
  writeCSSFiles?: boolean;
}

const plugin = createUnplugin<PluginOpts>((opts = {}) => {
  const cssByFile = new Map<string, string>();
  return {
    name: 'severed',
    async transform(code, id) {
      // TODO: more exts?
      if (!id.endsWith('.js') && !id.endsWith('.ts') && !id.endsWith('.tsx'))
        return;
      cssByFile.delete(id);
      let cssForThisFile = '';
      // @ts-expect-error
      const resolve = this.resolve?.bind(this) as
        | import('rollup').PluginContext['resolve']
        | undefined;
      const emitCSS = (inputCSS: string) => {
        const className = `severed-${hash([inputCSS]).slice(0, 7)}`;
        const outputCSS = stylis.serialize(
          stylis.compile(`.${className} {\n${inputCSS}\n}`),
          stylis.middleware([stylis.namespace, stylis.stringify]),
        );
        cssForThisFile += `\n\n${outputCSS}`;
        return className;
      };
      const transformResult = await transform(
        code,
        id,
        emitCSS,
        opts.writeCSSFiles
          ? () => id + suffix
          : () =>
              // Has to end with .css to be detected correctly by some bundlers
              `${id}?severed=${hash([cssForThisFile]).slice(0, 5)}&lang.css`,
        resolve,
      );
      if (!transformResult) return null;

      cssByFile.set(id, cssForThisFile);
      if (opts.writeCSSFiles) {
        this.emitFile({
          type: 'asset',
          fileName: id + suffix,
          source: cssForThisFile,
        });
      }

      return transformResult;
    },
    async resolveId(id) {
      if (opts.writeCSSFiles) {
        if (id.endsWith(suffix)) {
          return { id, external: true };
        }
      } else {
        const params = new URLSearchParams(id.slice(id.indexOf('?')));
        const severedParam = params.get('severed');
        if (severedParam) return id;
      }
    },
    async load(id) {
      if (opts.writeCSSFiles) return;
      const params = new URLSearchParams(id.slice(id.indexOf('?')));
      const severedParam = params.get('severed');
      const idWithoutParam = id.slice(0, id.indexOf('?'));
      if (!severedParam) return;
      const fallback = path.join(process.cwd(), idWithoutParam);
      return cssByFile.get(idWithoutParam) || cssByFile.get(fallback);
    },
  };
});

export const { rollup, esbuild, vite } = plugin;

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  const { rollup } = await import('rollup');

  const inputCode = dedent`
    const color = 'red'
    el.classList.append(css\`
      background: \${color}
    \`)
  `;

  test('rollup build with writeCSSFiles: true', async () => {
    const virtualEntryName = 'virtual-entry.js';
    const virtualEntryPlugin: import('rollup').Plugin = {
      name: 'virtual-entry',
      resolveId(id) {
        if (id === virtualEntryName) return id;
      },
      load(id) {
        if (id === virtualEntryName) return inputCode;
      },
    };
    const build = await rollup({
      input: { index: virtualEntryName },
      plugins: [virtualEntryPlugin, plugin.rollup({ writeCSSFiles: true })],
    });
    const output = await build.generate({});
    const normalizedOutput = output.output.map((file) => ({
      fileName: file.fileName,
      code: file.type === 'asset' ? file.source : file.code,
    }));
    expect(normalizedOutput).toMatchInlineSnapshot(`
      [
        {
          "code": "import 'virtual-entry.js.severed.css';

      el.classList.append(\\"severed-18da80c\\");
      ",
          "fileName": "index.js",
        },
        {
          "code": "

      .severed-18da80c{background:red;}",
          "fileName": "virtual-entry.js.severed.css",
        },
      ]
    `);
  });

  test('rollup build with rollup-plugin-css-only', async () => {
    const { default: rollupPluginCssOnly } = await import(
      'rollup-plugin-css-only'
    );

    const virtualEntryName = 'virtual-entry.js';
    const virtualEntryPlugin: import('rollup').Plugin = {
      name: 'virtual-entry',
      resolveId(id) {
        if (id === virtualEntryName) return id;
      },
      load(id) {
        if (id === virtualEntryName) return inputCode;
      },
    };
    const build = await rollup({
      input: { index: virtualEntryName },
      plugins: [
        virtualEntryPlugin,
        plugin.rollup(),
        rollupPluginCssOnly({
          output: true,
        }) as any,
      ],
    });
    const output = await build.generate({});
    const normalizedOutput = output.output.map((file) => ({
      fileName: file.fileName,
      code: file.type === 'asset' ? file.source : file.code,
    }));
    expect(normalizedOutput).toMatchInlineSnapshot(`
      [
        {
          "code": "el.classList.append(\\"severed-18da80c\\");
      ",
          "fileName": "index.js",
        },
        {
          "code": "

      .severed-18da80c{background:red;}",
          "fileName": "bundle.css",
        },
      ]
    `);
  });

  test('esbuild', async () => {
    const { build } = await import('esbuild');
    const outDir = 'test-dist';
    await fs.rm(outDir, { recursive: true, force: true });

    const result = await build({
      entryPoints: ['./fixtures/index.js'],
      plugins: [plugin.esbuild()],
      bundle: true,
      format: 'esm',
      outdir: outDir,
      logLevel: 'silent',
    });

    expect(result.errors).toMatchInlineSnapshot('[]');

    const outFileNames = await fs.readdir(outDir);
    const outFiles = await Promise.all(
      outFileNames.map(async (fileName) => ({
        fileName,
        code: (
          await fs.readFile(path.join(outDir, fileName), 'utf8')
        ).replace(
          new RegExp(path.dirname(fileURLToPath(import.meta.url)), 'g'),
          '<root>',
        ),
      })),
    );

    expect(outFiles).toMatchInlineSnapshot(`
      [
        {
          "code": "/* severed:<root>/fixtures/index.js?severed=a96c0&lang.css */
      .severed-d01cdb2 {
        background: green;
      }
      ",
          "fileName": "index.css",
        },
        {
          "code": "\\"use strict\\";

      // fixtures/index.js
      el.classList.add(\\"severed-d01cdb2\\");
      ",
          "fileName": "index.js",
        },
      ]
    `);

    await fs.rm(outDir, { recursive: true });
  });
}
