import type { NextConfig } from 'next';
import { realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import createMDX from '@next/mdx';

const repository = join(import.meta.dirname, '../..');
const adecore = realpathSync(join(import.meta.dirname, 'node_modules/@adecore/ui'));

// `bun run adecore:link` points ADE CORE at the checkout beside this one, which Turbopack only reads inside its root.
const root = relative(repository, adecore).startsWith('..') ? dirname(repository) : repository;

const config: NextConfig = {
    // Nothing here runs on a server: every page is a file, served by Cloudflare's static assets.
    output: 'export',
    pageExtensions: ['ts', 'tsx', 'mdx'],
    poweredByHeader: false,
    images: { unoptimized: true },
    turbopack: { root },
    // `bun run typecheck` checks with TypeScript 7, which has no compiler API for Next to call.
    typescript: { ignoreBuildErrors: true }
};

// By name, so Turbopack can hand the plugin to its loader; GitHub's markdown gives the pages their tables.
export default createMDX({ options: { remarkPlugins: [['remark-gfm']] } })(config);
