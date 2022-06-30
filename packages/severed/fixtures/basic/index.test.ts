import { test } from 'vitest';
import * as rollup from 'rollup';
import { expect } from 'vitest';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { fileURLToPath } from 'url';
import * as path from 'path';
import { rollupPlugin } from 'severed';

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
          (await fs.readFile(fullPath, 'utf8')).trim(),
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

test('rollup output with writeCSSFiles', async () => {
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