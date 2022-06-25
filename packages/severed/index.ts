import { dedent } from './dedent.js';
import { createUnplugin } from 'unplugin';
import { transform } from './transform-file.js';
import * as fs from 'fs/promises';
import * as path from 'path';

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
      if (id.endsWith(suffix)) return;
      cssByFile.delete(id);
      let cssForThisFile = '';
      const emitCSS = (css: string) => {
        cssForThisFile += `\n\n${css}`;
        return '.hi';
      };
      const transformResult = await transform(code, id, emitCSS);

      const cssFileName = id + suffix;
      cssByFile.set(cssFileName, cssForThisFile);
      if (opts.writeCSSFiles) {
        this.emitFile({
          type: 'asset',
          fileName: cssFileName,
          source: cssForThisFile,
        });
      }

      return transformResult;
    },
    resolveId(id) {
      if (id.endsWith(suffix))
        return { id, external: Boolean(opts.writeCSSFiles) };
    },
    async load(id) {
      // TODO: remove/disable load hook if writeCSSFiles is true?
      if (!id.endsWith(suffix)) return;
      return cssByFile.get(id);
    },
  };
});

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
    const virtualEntryName = 'virtual-entry';
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
          "code": "import 'virtual-entry.severed.css';

      el.classList.append(\\".hi\\");
      ",
          "fileName": "index.js",
        },
        {
          "code": "


        background: red
      ",
          "fileName": "virtual-entry.severed.css",
        },
      ]
    `);
  });

  test('rollup build with rollup-plugin-css-only', async () => {
    const { default: rollupPluginCssOnly } = await import(
      'rollup-plugin-css-only'
    );

    const virtualEntryName = 'virtual-entry';
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
          "code": "el.classList.append(\\".hi\\");
      ",
          "fileName": "index.js",
        },
        {
          "code": "


        background: red
      ",
          "fileName": "bundle.css",
        },
      ]
    `);
  });

  test.only('esbuild', async () => {
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
        code: await fs.readFile(path.join(outDir, fileName), 'utf8'),
      })),
    );

    expect(outFiles).toMatchInlineSnapshot(`
      [
        {
          "code": "/* severed:/home/caleb/Programming/calebeby/severed/packages/severed/fixtures/index.js.severed.css */
      background: green; {
      }
      ",
          "fileName": "index.css",
        },
        {
          "code": "\\"use strict\\";

      // fixtures/index.js
      el.classList.add(\\".hi\\");
      ",
          "fileName": "index.js",
        },
      ]
    `);

    await fs.rm(outDir, { recursive: true });
  });
}
