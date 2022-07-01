import { expect, test } from 'vitest';

import * as path from 'path';
import { rollupPlugin, esbuildPlugin } from 'severed';
import rollupPluginCSSOnly from 'rollup-plugin-css-only';
import { fileURLToPath } from 'url';
import {
  dirSnapshot,
  makeEsbuildFixture,
  makeRollupFixture,
  rollupPluginEsbuild,
} from '../test-utils.js';
import { nodeResolve } from '@rollup/plugin-node-resolve';

const cwd = path.dirname(fileURLToPath(import.meta.url));

test('rollup throws without node-resolve', async () => {
  const error = await makeRollupFixture(
    cwd,
    'rollup-no-plugin-no-node-resolve',
    {
      input: path.join(cwd, 'input', 'index.js'),
    },
  ).catch((error) => error);

  expect(error).toMatchInlineSnapshot(
    "[Error: Could not resolve './second' from fixtures/multiple-files-with-and-without-css/input/index.js]",
  );
});

test('rollup output without severed plugin', async () => {
  const outDir = await makeRollupFixture(cwd, 'rollup-no-plugin', {
    input: path.join(cwd, 'input', 'index.js'),
    plugins: [
      rollupPluginEsbuild(),
      nodeResolve({ extensions: ['.js', '.ts'] }),
    ],
  });

  expect(await dirSnapshot(outDir)).toMatchInlineSnapshot(`
    file index.js {
      doesNotExist;
      const green = "#0f0";
      const getPurple = () => "#f0f";
      
      const foo = (el) => {
        el.classList.add(css\`
          color: \${getPurple()};
        \`);
      };
      
      const className = css\`
        background: \${green};
      \`;
      el.classList.add(className);
      foo(el);
    }
  `);
});

test('rollup output with writeCSSFiles: true', async () => {
  const outDir = await makeRollupFixture(cwd, 'rollup-writeCSSFiles', {
    input: path.join(cwd, 'input', 'index.js'),
    // This test shows that the other rollup plugins
    // are getting passed to the inner rollup instance
    plugins: [
      rollupPluginEsbuild(),
      nodeResolve({ extensions: ['.js', '.ts'] }),
      rollupPlugin({ writeCSSFiles: true }),
    ],
  });

  expect(await dirSnapshot(outDir)).toMatchInlineSnapshot(`
    file fixtures-multiple-files-with-and-without-css-input-index-js.severed.css {
      .severed-91d2b32{background:#0f0;}
    }
    file fixtures-multiple-files-with-and-without-css-input-second-ts.severed.css {
      .severed-aa4121a{color:#f0f;}
    }
    file index.js {
      import './fixtures-multiple-files-with-and-without-css-input-index-js.severed.css';
      import './fixtures-multiple-files-with-and-without-css-input-second-ts.severed.css';
      
      doesNotExist;
      
      const foo = (el) => {
        el.classList.add("severed-aa4121a");
      };
      
      const className = "severed-91d2b32";
      el.classList.add(className);
      foo(el);
    }
  `);
});

test('rollup output with writeCSSFiles: true and multiple JS entrypoints', async () => {
  const outDir = await makeRollupFixture(
    cwd,
    'rollup-writeCSSFiles-multiple-entrypoints',
    {
      input: [
        path.join(cwd, 'input', 'index.js'),
        path.join(cwd, 'input', 'second.ts'),
      ],
      // This test shows that the other rollup plugins
      // are getting passed to the inner rollup instance
      plugins: [
        rollupPluginEsbuild(),
        nodeResolve({ extensions: ['.js', '.ts'] }),
        rollupPlugin({ writeCSSFiles: true }),
      ],
    },
  );

  expect(await dirSnapshot(outDir)).toMatchInlineSnapshot(`
    file fixtures-multiple-files-with-and-without-css-input-index-js.severed.css {
      .severed-91d2b32{background:#0f0;}
    }
    file fixtures-multiple-files-with-and-without-css-input-second-ts.severed.css {
      .severed-aa4121a{color:#f0f;}
    }
    file index.js {
      import './fixtures-multiple-files-with-and-without-css-input-index-js.severed.css';
      import { foo } from './second.js';
      import './fixtures-multiple-files-with-and-without-css-input-second-ts.severed.css';
      
      const className = "severed-91d2b32";
      el.classList.add(className);
      foo(el);
    }
    file second.js {
      import './fixtures-multiple-files-with-and-without-css-input-second-ts.severed.css';
      
      doesNotExist;
      
      const foo = (el) => {
        el.classList.add("severed-aa4121a");
      };
      
      export { foo };
    }
  `);
});

test('rollup output with default settings and no css plugin', async () => {
  const error = await makeRollupFixture(cwd, 'rollup-writeCSSFiles', {
    input: path.join(cwd, 'input', 'index.js'),
    plugins: [
      rollupPluginEsbuild(),
      nodeResolve({ extensions: ['.js', '.ts'] }),
      rollupPlugin(),
    ],
  }).catch((error) => error);

  expect(error).toMatchInlineSnapshot(
    '[Error: Unexpected token (Note that you need plugins to import files that are not JavaScript)]',
  );
  expect(error.frame).toMatchInlineSnapshot(`
    "1: 
    2: 
    3: .severed-91d2b32{background:#0f0;}
       ^"
  `);
});

test('rollup output with default settings and rollup-plugin-css-only', async () => {
  const outDir = await makeRollupFixture(cwd, 'rollup-writeCSSFiles', {
    input: path.join(cwd, 'input', 'index.js'),
    plugins: [
      rollupPluginEsbuild(),
      nodeResolve({ extensions: ['.js', '.ts'] }),
      rollupPlugin(),
      rollupPluginCSSOnly() as any,
    ],
  });

  expect(await dirSnapshot(outDir)).toMatchInlineSnapshot(`
    file bundle.css {
      .severed-91d2b32{background:#0f0;}
      
      .severed-aa4121a{color:#f0f;}
    }
    file index.js {
      doesNotExist;
      
      const foo = (el) => {
        el.classList.add("severed-aa4121a");
      };
      
      const className = "severed-91d2b32";
      el.classList.add(className);
      foo(el);
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
      /* severed:<cwd>/fixtures/multiple-files-with-and-without-css/input/index.js?severed=444d8&lang.css */
      .severed-91d2b32 {
        background: #0f0;
      }
      
      /* severed:<cwd>/fixtures/multiple-files-with-and-without-css/input/second.ts?severed=2dfee&lang.css */
      .severed-aa4121a {
        color: #f0f;
      }
    }
    file index.js {
      "use strict";
      
      // fixtures/multiple-files-with-and-without-css/input/second.ts
      var foo = (el2) => {
        el2.classList.add("severed-aa4121a");
      };
      
      // fixtures/multiple-files-with-and-without-css/input/colors.ts
      var f = doesNotExist;
      
      // fixtures/multiple-files-with-and-without-css/input/index.js
      var className = "severed-91d2b32";
      el.classList.add(className);
      foo(el);
    }
  `);
});
