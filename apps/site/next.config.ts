import type { NextConfig } from 'next';
import { initOpenNextCloudflareForDev } from '@opennextjs/cloudflare';

const config: NextConfig = {
    poweredByHeader: false,
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

export default config;

initOpenNextCloudflareForDev();
