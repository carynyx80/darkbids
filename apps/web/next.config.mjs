import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';

const sdkRequire = createRequire(import.meta.resolve('@heliuslabs/spr'));
const hasher = dirname(sdkRequire.resolve('@lightprotocol/hasher.rs/package.json'));
const wasmNames = ['light_wasm_hasher_bg.wasm', 'hasher_wasm_simd_bg.wasm'];

/** @type {import('next').NextConfig} */
const config = {
  transpilePackages: ['@veil/core', '@heliuslabs/spr'],
  experimental: { cpus: 2 },
  webpack(config) {
    for (const file of wasmNames) {
      config.resolve.alias[`${file}$`] = join(hasher, 'dist', file);
    }
    config.module.rules.push({ test: /(?:light_wasm_hasher|hasher_wasm_simd)_bg\.wasm$/, type: 'asset/resource' });
    return config;
  },
};
export default config;
