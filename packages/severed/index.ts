import { createUnplugin } from 'unplugin';
import { transform } from './transform-file.js';
import * as path from 'path';
import * as stylis from 'stylis';
import * as crypto from 'crypto';

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
      // If opts.writeCSSFiles is used, the filename in the output folder
      const distFileName =
        path.relative(process.cwd(), id).replace(/[^a-zA-Z]+/g, '-') + suffix;
      const transformResult = await transform(
        code,
        id,
        emitCSS,
        opts.writeCSSFiles
          ? () => `./${distFileName}`
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
          fileName: distFileName,
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

export const rollupPlugin = plugin.rollup;
export const esbuildPlugin = plugin.esbuild;
export const vitePlugin = plugin.vite;
