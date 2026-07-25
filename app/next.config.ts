import type { NextConfig } from 'next';

/**
 * The app imports the shared clipboard parser and the frozen template ids from
 * outside its own directory (../payload, ../tools) — one source of truth with
 * the installer payload. On Vercel this needs "Include source files outside of
 * the Root Directory" enabled, or the build cannot see them.
 */
const nextConfig: NextConfig = {
  outputFileTracingRoot: __dirname,
};

export default nextConfig;
