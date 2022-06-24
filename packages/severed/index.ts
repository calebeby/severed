import { dedent } from './dedent.js';
import { createUnplugin } from 'unplugin';
import { transform } from './transform-file.js';

const hash = (inputs: string[]) => {
  const h = crypto.createHash('sha512');
  for (const input of inputs) h.update(input);
  return h.digest('hex');
};

const suffix = '.severed.css';

const plugin = createUnplugin(() => {
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

      cssByFile.set(id + suffix, cssForThisFile);
      this.emitFile({
        type: 'asset',
        fileName: id + suffix,
        source: cssForThisFile,
      });

      return transformResult;
    },
    resolveId(id) {
      if (id.endsWith(suffix)) return { id, external: true };
    },
    async load(id) {
      if (!id.endsWith(suffix)) return;
      return cssByFile.get(id);
    },
  };
});

if (import.meta.vitest) {
  const { test, expect } = import.meta.vitest;
  const { rollup } = await import('rollup');

  test('rollup build', async () => {
    const inputCode = dedent`
      const color = 'red'
      el.classList.append(css\`
        background: \${color}
      \`)
    `;

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
      plugins: [virtualEntryPlugin, plugin.rollup()],
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
}
