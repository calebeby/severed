/* c8 ignore start */
import * as rollup from 'rollup';
import * as esbuild from 'esbuild';
import { expect } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';

export const rollupPluginEsbuild: () => rollup.Plugin = () => ({
  name: 'rollup-plugin-esbuild',
  async transform(code, id) {
    const loader = id.endsWith('.ts')
      ? 'ts'
      : id.endsWith('.tsx')
      ? 'tsx'
      : id.endsWith('.js')
      ? 'js'
      : undefined;
    if (!loader) return;
    try {
      const result = await esbuild.transform(code, {
        sourcefile: id,
        loader,
      });
      return { code: result.code };
    } catch (error) {
      this.error(error.message, error.errors?.[0]?.location);
    }
  },
});

export const makeRollupFixture = async (
  cwd: string,
  name: string,
  config: rollup.RollupOptions,
) => {
  const outDir = path.join(cwd, `dist-${name}`);
  await fs.rm(outDir, { recursive: true, force: true });
  const build = await rollup.rollup(config);
  await build.write({ dir: outDir });
  return outDir;
};

export const makeEsbuildFixture = async (
  cwd: string,
  name: string,
  config: esbuild.BuildOptions,
) => {
  const outDir = path.join(cwd, `dist-${name}`);
  await fs.rm(outDir, { recursive: true, force: true });
  const result = await esbuild.build({
    logLevel: 'silent',
    outdir: outDir,
    ...config,
  });
  expect(result.errors).toHaveLength(0);
  expect(result.warnings).toHaveLength(0);
  return outDir;
};

const indent = (text: string) =>
  text
    .split('\n')
    .map((l) => `  ${l}`)
    .join('\n');

export const dirSnapshot = async (
  dirName: string,
): Promise<{ str: string }> => {
  const paths = await fs.readdir(dirName);
  let output = [];
  for (const basename of paths) {
    const fullPath = path.join(dirName, basename);
    const f = fsSync.statSync(fullPath);
    if (f.isDirectory()) {
      output.push(
        `folder ${basename} {\n${indent((await dirSnapshot(fullPath)).str)}\n}`,
      );
    } else {
      output.push(
        `file ${basename} {\n${indent(
          (await fs.readFile(fullPath, 'utf8'))
            .trim()
            .replace(new RegExp(process.cwd(), 'g'), '<cwd>'),
        )}\n}`,
      );
    }
  }
  return { str: output.join('\n'), [dirSnapshotSymbol]: true } as any;
};

const dirSnapshotSymbol = Symbol('dirSnapshot');

expect.addSnapshotSerializer({
  test: (foo) => foo && typeof foo === 'object' && foo[dirSnapshotSymbol],
  print(val: any) {
    return val.str;
  },
});

/* c8 ignore stop */
