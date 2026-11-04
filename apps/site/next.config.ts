import { realpathSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import createMDX from '@next/mdx';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';
import type { NextConfig } from 'next';

const repository = join(import.meta.dirname, '../..');
const adecore = realpathSync(join(import.meta.dirname, 'node_modules/@adecore/ui'));

// `bun run adecore:link` points ADE CORE at the checkout beside this one, which Turbopack only reads inside its root.
const root = relative(repository, adecore).startsWith('..') ? dirname(repository) : repository;

const config: NextConfig = {
    poweredByHeader: false,
    pageExtensions: ['ts', 'tsx', 'mdx'],
    turbopack: { root },
    // `bun run typecheck` checks with TypeScript 7, which has no compiler API for Next to call.
    typescript: { ignoreBuildErrors: true },
    async headers() {
        return [
            {
                source: '/:path*',
                headers: [
                    { key: 'X-Content-Type-Options', value: 'nosniff' },
                    { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
                    { key: 'Content-Security-Policy', value: "frame-ancestors 'none'" },
                    { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }
                ]
            }
        ];
    }
};

// By name, so Turbopack can hand the plugin to its loader; GitHub's markdown gives the documentation its tables.
export default createMDX({ options: { remarkPlugins: [['remark-gfm']] } })(config);

initOpenNextCloudflareForDev();
