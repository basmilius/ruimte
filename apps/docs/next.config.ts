import type { NextConfig } from 'next';
import createMDX from '@next/mdx';

const config: NextConfig = {
    // Nothing here runs on a server: every page is a file, served by Cloudflare's static assets.
    output: 'export',
    pageExtensions: ['ts', 'tsx', 'mdx'],
    poweredByHeader: false,
    images: { unoptimized: true },
    // `bun run typecheck` checks with TypeScript 7, which has no compiler API for Next to call.
    typescript: { ignoreBuildErrors: true }
};

// By name, so Turbopack can hand the plugin to its loader; GitHub's markdown gives the pages their tables.
export default createMDX({ options: { remarkPlugins: [['remark-gfm']] } })(config);
