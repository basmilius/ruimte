import { defineCloudflareConfig } from '@opennextjs/cloudflare';
import staticAssetsIncrementalCache from '@opennextjs/cloudflare/overrides/incremental-cache/static-assets-incremental-cache';

// Every page is prerendered and nothing revalidates, so the build's own output is the cache.
export default defineCloudflareConfig({
    incrementalCache: staticAssetsIncrementalCache,
    enableCacheInterception: true
});
