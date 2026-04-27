// This file is part of midnightntwrk/example-counter.
// Copyright (C) Midnight Foundation
// SPDX-License-Identifier: Apache-2.0
// Licensed under the Apache License, Version 2.0 (the "License");
// You may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import wasm from 'vite-plugin-wasm';
import topLevelAwait from 'vite-plugin-top-level-await';
import { nodePolyfills } from 'vite-plugin-node-polyfills';

// https://vitejs.dev/config/
export default defineConfig({
  cacheDir: './.vite',
  build: {
    target: 'esnext',
    minify: false,
    rollupOptions: {
      output: {
        manualChunks: {
          // Separate chunk for WASM modules to avoid top-level await issues
          wasm: ['@midnight-ntwrk/onchain-runtime-v3'],
        },
      },
    },
    commonjsOptions: {
      // Transform CommonJS to ESM more aggressively
      transformMixedEsModules: true,
      extensions: ['.js', '.cjs'],
      // Needed for Node.js modules
      ignoreDynamicRequires: true,
    },
  },
  plugins: [
    react(),
    nodePolyfills({
      include: ['buffer', 'process', 'util', 'stream', 'events', 'fs', 'path', 'crypto'],
      globals: { Buffer: true, global: true, process: true },
      protocolImports: true,
    }),
    // Configure WASM plugin with more options
    wasm(),
    topLevelAwait({
      // Be more permissive with top-level await
      promiseExportName: '__tla',
      promiseImportName: (i) => `__tla_${i}`,
    }),
    // Custom resolver for handling problematic modules
    {
      name: 'wasm-module-resolver',
      resolveId(source, importer) {
        // Special handling for the problematic module
        if (
          source === '@midnight-ntwrk/onchain-runtime-v3' &&
          importer &&
          importer.includes('@midnight-ntwrk/compact-runtime')
        ) {
          // Force dynamic import for this case
          return {
            id: source,
            external: false,
            moduleSideEffects: true,
          };
        }
        return null;
      },
    },
    // libsodium-wrappers-sumo@0.7.16 ships a wrapper that does
    //   import e from "./libsodium-sumo.mjs"
    // but the file isn't shipped next to the wrapper — the actual module lives
    // in the separate `libsodium-sumo` package. Bundlers (Rollup) error with
    // "Could not resolve ./libsodium-sumo.mjs". Redirect that relative import
    // to the real package using Rollup's own resolver so it picks the ESM
    // entry (libsodium-sumo/dist/modules-sumo-esm/libsodium-sumo.mjs).
    {
      name: 'libsodium-sumo-resolver',
      async resolveId(source, importer) {
        if (
          source === './libsodium-sumo.mjs' &&
          importer &&
          importer.includes('libsodium-wrappers-sumo')
        ) {
          const resolved = await this.resolve('libsodium-sumo', importer, {
            skipSelf: true,
          });
          return resolved?.id ?? null;
        }
        return null;
      },
    },
  ],
  optimizeDeps: {
    esbuildOptions: {
      target: 'esnext',
      supported: { 'top-level-await': true },
      // Configure ESBuild to handle Node.js-style modules
      platform: 'browser',
      format: 'esm',
      loader: {
        '.wasm': 'binary',
      },
    },
    // Explicitly include these packages for pre-bundling, but force ESM
    include: ['@midnight-ntwrk/compact-runtime'],
    // Exclude WASM files and modules with top-level await from optimization
    exclude: [
      '@midnight-ntwrk/onchain-runtime-v3',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm_bg.wasm',
      '@midnight-ntwrk/onchain-runtime-v3/midnight_onchain_runtime_wasm.js',
    ],
  },
  // Build-time constants. `__BUILD_TIME__` gives us a cheap way to verify
  // at runtime that the browser is loading the freshly-built bundle (not a
  // cached one). Logged at app boot in main.tsx; also rendered in the
  // Header as a tiny muted timestamp chip.
  define: {
    __BUILD_TIME__: JSON.stringify(new Date().toISOString()),
  },
  // Add specific import configuration for more control
  resolve: {
    // Ensure WASM files are loaded properly
    extensions: ['.mjs', '.js', '.ts', '.jsx', '.tsx', '.json', '.wasm'],
    mainFields: ['browser', 'module', 'main'],
  },
});
