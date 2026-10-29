import { readFile } from 'node:fs/promises';
import { gzipSync } from 'node:zlib';

/*
 * Hands the source map `scripts/compile.ts` kept beside a compiled daemon to Observatory, under the
 * debug id it carries, so the frames of a crash report from that binary read as source again.
 *
 *   OBSERVATORY_UPLOAD_TOKEN=... bun scripts/upload-source-map.ts dist/mac-arm64.symbols/ruimte.map
 *
 * The bundle itself goes along empty: Observatory reads it only for the names of minified scopes,
 * and the daemon keeps its names.
 */
const OBSERVATORY_URL = 'https://ingest.bmnw.nl';

const [path] = process.argv.slice(2);
const token = process.env.OBSERVATORY_UPLOAD_TOKEN ?? '';

if (path === undefined || token === '') {
    console.error('Usage: OBSERVATORY_UPLOAD_TOKEN=<token> bun scripts/upload-source-map.ts <ruimte.map>');
    process.exit(1);
}

const map = await readFile(path, 'utf8');
const debugId = (JSON.parse(map) as { debug_id?: unknown }).debug_id;

if (typeof debugId !== 'string') {
    console.error(`${path} carries no debug_id; compile the daemon with scripts/compile.ts`);
    process.exit(1);
}

const { missing } = (await (await post('/api/symbols/sourcemaps/check', { debug_ids: [debugId] })).json()) as { missing: string[] };

if (!missing.includes(debugId)) {
    console.log(`Observatory already has the source map ${debugId}`);
    process.exit(0);
}

await post('/api/symbols/sourcemaps', { debug_id: debugId, file: 'ruimte', source: '', map });
console.log(`Uploaded the source map ${debugId}`);

async function post(route: string, body: unknown): Promise<Response> {
    const response = await fetch(`${OBSERVATORY_URL}${route}`, {
        method: 'POST',
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', 'content-encoding': 'gzip' },
        body: gzipSync(JSON.stringify(body))
    });
    if (!response.ok) {
        console.error(`${route} answered ${response.status}: ${await response.text().catch(() => '')}`);
        process.exit(1);
    }
    return response;
}
