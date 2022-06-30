import { test } from 'vitest';
import * as rollup from 'rollup';
import * as esbuild from 'esbuild';
import { expect } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { rollupPlugin, esbuildPlugin } from 'severed';
import rollupPluginCSSOnly from 'rollup-plugin-css-only';

const cwd = path.dirname(fileURLToPath(import.meta.url));

const makeRollupFixture = async (
  name: string,
  config: rollup.RollupOptions,
) => {
  const outDir = path.join(cwd, `dist-${name}`);
  await fs.rm(outDir, { recursive: true, force: true });
  const build = await rollup.rollup(config);
  await build.write({ dir: outDir });
  return outDir;
};

const makeEsbuildFixture = async (
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

const dirSnapshot = async (dirName: string): Promise<{ str: string }> => {
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

test('rollup output without plugin', async () => {
  const outDir = await makeRollupFixture('rollup-no-plugin', {
    input: path.join(cwd, 'input', 'index.js'),
  });

  expect(await dirSnapshot(outDir)).toMatchInlineSnapshot(`
    file index.js {
      const className = css\`
        background: green;
      \`;
      
      el.classList.add(className);
    }
  `);
});

test('rollup output with writeCSSFiles: true', async () => {
  const outDir = await makeRollupFixture('rollup-writeCSSFiles', {
    input: path.join(cwd, 'input', 'index.js'),
    plugins: [rollupPlugin({ writeCSSFiles: true })],
  });

  expect(await dirSnapshot(outDir)).toMatchInlineSnapshot(`
    file fixtures-basic-input-index-js.severed.css {
      .severed-d01cdb2{background:green;}
    }
    file index.js {
      import './fixtures-basic-input-index-js.severed.css';
      
      const className = "severed-d01cdb2";
      
      el.classList.add(className);
    }
  `);
});

test('rollup output with default settings and no css plugin', async () => {
  const error = await makeRollupFixture('rollup-writeCSSFiles', {
    input: path.join(cwd, 'input', 'index.js'),
    plugins: [rollupPlugin()],
  }).catch((error) => error);

  expect(error).toMatchInlineSnapshot(
    '[Error: Unexpected token (Note that you need plugins to import files that are not JavaScript)]',
  );
  expect(error.frame).toMatchInlineSnapshot(`
    "1: 
    2: 
    3: .severed-d01cdb2{background:green;}
       ^"
  `);
});

test('rollup output with default settings and rollup-plugin-css-only', async () => {
  const outDir = await makeRollupFixture('rollup-writeCSSFiles', {
    input: path.join(cwd, 'input', 'index.js'),
    plugins: [rollupPlugin(), rollupPluginCSSOnly() as any],
  });

  expect(await dirSnapshot(outDir)).toMatchInlineSnapshot(`
    file bundle.css {
      .severed-d01cdb2{background:green;}
    }
    file index.js {
      const className = "severed-d01cdb2";
      
      el.classList.add(className);
    }
  `);
});

test('esbuild output with default settings', async () => {
  const outDir = await makeEsbuildFixture('esbuild-default', {
    entryPoints: [path.join(cwd, 'input', 'index.js')],
    plugins: [esbuildPlugin()],
    bundle: true,
    format: 'esm',
  });

  expect(await dirSnapshot(outDir)).toMatchInlineSnapshot(`
    file index.css {
      /* severed:<cwd>/fixtures/basic/input/index.js?severed=a96c0&lang.css */
      .severed-d01cdb2 {
        background: green;
      }
    }
    file index.js {
      "use strict";
      
      // fixtures/basic/input/index.js
      var className = "severed-d01cdb2";
      el.classList.add(className);
    }
  `);
});
