import { createUnplugin } from 'unplugin';
import { transform } from './transform-file.js';
import * as path from 'path';
import * as stylis from 'stylis';
import * as crypto from 'crypto';
import type * as esbuild from 'esbuild';
import type * as rollup from 'rollup';

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
const PLUGIN_NAME = 'severed';

const makePlugin = (build?: esbuild.PluginBuild) =>
  createUnplugin<PluginOpts>((opts = {}) => {
    const cssByFile = new Map<string, string>();
    let otherPlugins: rollup.Plugin[] | undefined;
    return {
      name: PLUGIN_NAME,
      rollup: {
        options(opts) {
          otherPlugins = opts.plugins?.filter(
            (plugin): plugin is rollup.Plugin => {
              if (!plugin) return false;
              if (plugin.name === PLUGIN_NAME) return false;
              return true;
            },
          );
        },
      },
      async transform(code, id) {
        // TODO: more exts?
        if (!id.endsWith('.js') && !id.endsWith('.ts') && !id.endsWith('.tsx'))
          return;
        cssByFile.delete(id);
        let cssForThisFile = '';

        const emitCSS = (inputCSS: string) => {
          const className = `severed-${hash([inputCSS]).slice(0, 7)}`;
          const outputCSS = stylis.serialize(
            stylis.compile(`.${className} {\n${inputCSS}\n}`),
            stylis.middleware([stylis.namespace, stylis.stringify]),
          );
          cssForThisFile += `\n\n${outputCSS}`;
          return className;
        };

        const resolve = async (id: string, importer?: string) => {
          // @ts-expect-error
          if (this.resolve) {
            // @ts-expect-error
            return (this.resolve as rollup.PluginContext['resolve'])(
              id,
              importer,
            );
          }
          if (build) {
            const result = await build.resolve(id, {
              importer,
              resolveDir: importer && path.dirname(importer),
            });
            if (result.path) return { id: result.path };
          }
          return null;
        };

        const esbuildTransform = async (code: string, id: string) => {
          if (build) {
            const opts: esbuild.TransformOptions = {
              sourcefile: id,
              loader: id.endsWith('.ts')
                ? 'ts'
                : id.endsWith('.tsx')
                ? 'tsx'
                : 'js',
            };
            const result: esbuild.TransformResult =
              await build.esbuild.transform(code, opts);
            return result.code;
          }
          return code;
        };

        // If opts.writeCSSFiles is used, the filename in the output folder
        const distFileName =
          path.relative(process.cwd(), id).replace(/[^a-zA-Z]+/g, '-') + suffix;
        const transformResult = await transform(
          await esbuildTransform(code, id),
          id,
          emitCSS,
          opts.writeCSSFiles
            ? () => `./${distFileName}`
            : () =>
                // Has to end with .css to be detected correctly by some bundlers
                `${id}?severed=${hash([cssForThisFile]).slice(0, 5)}&lang.css`,
          [
            ...(otherPlugins || []),
            {
              name: 'severed-parent-resolve',
              resolveId(id, importer) {
                return resolve?.(id, importer);
              },
            },
            {
              name: 'severed-transform-resolve',
              async transform(code, id) {
                return build && (await esbuildTransform(code, id));
              },
            },
          ],
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
        return cssByFile.get(idWithoutParam);
      },
    };
  });

const plugin = makePlugin();
export const rollupPlugin = plugin.rollup;
export const esbuildPlugin = (opts?: PluginOpts): esbuild.Plugin => {
  return {
    name: PLUGIN_NAME,
    setup: (build) => makePlugin(build).esbuild(opts).setup(build),
  };
};
export const vitePlugin = plugin.vite;
