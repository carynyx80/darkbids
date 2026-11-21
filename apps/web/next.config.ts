import type { NextConfig } from 'next';
const config: NextConfig = {
  transpilePackages: ['@veil/core', '@heliuslabs/spr'],
  experimental: { cpus: 2 },
};
export default config;
