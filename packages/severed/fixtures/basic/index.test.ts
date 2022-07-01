import { expect, test } from 'vitest';

import * as path from 'path';
import { rollupPlugin, esbuildPlugin } from 'severed';
import rollupPluginCSSOnly from 'rollup-plugin-css-only';
import { fileURLToPath } from 'url';
import {
  dirSnapshot,
  makeEsbuildFixture,
  makeRollupFixture,
} from '../test-utils.js';

const cwd = path.dirname(fileURLToPath(import.meta.url));

test('rollup output without severed plugin', async () => {
  const outDir = await makeRollupFixture(cwd, 'rollup-no-plugin', {
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
  const outDir = await makeRollupFixture(cwd, 'rollup-writeCSSFiles', {
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
  const error = await makeRollupFixture(cwd, 'rollup-writeCSSFiles', {
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
  const outDir = await makeRollupFixture(cwd, 'rollup-writeCSSFiles', {
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
  const outDir = await makeEsbuildFixture(cwd, 'esbuild-default', {
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

// TODO: esbuild with writeCSSFiles: true
