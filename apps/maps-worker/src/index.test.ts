import { describe, expect, test } from 'bun:test';
import { MapsErrorSchema, mapsTicketBytes, mapsTicketSubject, signMapsPath, signMapsTicket } from '@ruimte/pulsar';
import { KEY, ORIGIN, SECRET, assertWorkerdFetchOptions, harness } from './test/harness.ts';

const SPRITE = `https://api.tomtom.com/maps/orbis/assets/sprites/1.0.0/basic_mono-light/sprite?apiVersion=1&key=${KEY}`;
const GLYPHS = `https://api.tomtom.com/maps/orbis/assets/fonts/1.0.0/{fontstack}/{range}.pbf?key=${KEY}&apiVersion=1`;
const TILES = `https://api.tomtom.com/maps/orbis/map-display/tile/{z}/{x}/{y}?apiVersion=2&key=${KEY}`;
const TILEJSON = `https://api.tomtom.com/maps/orbis/map-display/tile.json?key=${KEY}`;

const TOMTOM_STYLE = {
    version: 8,
    sprite: SPRITE,
    glyphs: GLYPHS,
    sources: {
        vector: { type: 'vector', tiles: [TILES], maxzoom: 14, attribution: 'TomTom' },
        tilejson: { type: 'vector', url: TILEJSON }
    },
    layers: [{ id: 'background', type: 'background' }]
};

function json(body: unknown, headers: Record<string, string> = {}): Response {
    return new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });
}

async function errorCode(response: { json(): Promise<unknown> }): Promise<string> {
    return MapsErrorSchema.parse(await response.json()).error.code;
}

type Maps = ReturnType<typeof harness>;

/* The style as a client receives it, which is where every other address comes from. */
async function styled(maps: Maps, style: unknown = TOMTOM_STYLE): Promise<{ sprite: string; glyphs: string; tiles: string; tilejson: string }> {
    maps.answers = [() => json(style)];
    const received = (await (await maps.request('/v1/style?theme=light')).json()) as {
        sprite: string;
        glyphs: string;
        sources: { vector: { tiles: string[] }; tilejson: { url: string } };
    };
    maps.answers = [() => new Response('unexpected', { status: 500 })];
    maps.upstream.length = 0;
    return { sprite: received.sprite, glyphs: received.glyphs, tiles: received.sources.vector.tiles[0]!, tilejson: received.sources.tilejson.url };
}

/* What a client asks for once it fills a rewritten address in. */
function pathOf(address: string): string {
    return address.slice(ORIGIN.length);
}

describe('the ticket check', () => {
    const OTHER_SECRET = 'Zk3mQ8vJx1LpT5aRn0cWy7DbHfUe2GsOi9NtV4Xr6Ml';

    async function refused(maps: Maps, ticket: string | null): Promise<void> {
        const response = await maps.request('/v1/style?theme=light', { ticket });
        expect(response.status).toBe(401);
        expect(await errorCode(response)).toBe('bad-ticket');
        expect(maps.upstream).toEqual([]);
        expect(maps.limited).toEqual([]);
    }

    test('a ticket the address book signed with the secret, and not yet ended, is let through', async () => {
        const maps = harness();
        maps.answers = [() => json(TOMTOM_STYLE)];
        const response = await maps.request('/v1/style?theme=light', { ticket: await maps.ticket('account-1', 1) });
        expect(response.status).toBe(200);
        expect(maps.limited).toEqual([await mapsTicketSubject(SECRET, 'account-1')]);
    });

    test('an ended ticket is refused, also one that ends at this moment', async () => {
        const maps = harness();
        await refused(maps, await maps.ticket('account-1', -1_000));
        await refused(maps, await maps.ticket('account-1', 0));
    });

    test('a ticket signed with another secret is refused', async () => {
        const maps = harness();
        const foreign = await signMapsTicket(OTHER_SECRET, await mapsTicketSubject(OTHER_SECRET, 'account-1'), maps.now + 3_600_000);
        await refused(maps, foreign.ticket);
    });

    test('a ticket with a forged or changed mac is refused', async () => {
        const maps = harness();
        const [subject, expiresAt, mac] = (await maps.ticket()).split('.');
        await refused(maps, `${subject}.${expiresAt}.${'A'.repeat(43)}`);
        await refused(maps, `${subject}.${Number(expiresAt) + 1}.${mac}`);
    });

    test('a mark this service made for an address is no ticket, over the same bytes', async () => {
        const maps = harness();
        const [subject = '', expiry = ''] = (await maps.ticket()).split('.');
        const mark = await signMapsPath(SECRET, mapsTicketBytes(subject, Number(expiry)));
        await refused(maps, `${subject}.${expiry}.${mark}`);
    });

    test('a malformed ticket, or none, is refused', async () => {
        const maps = harness();
        const [subject, expiresAt, mac] = (await maps.ticket()).split('.');
        for (const ticket of [
            null,
            '',
            'nonsense',
            `${subject}.${expiresAt}`,
            `${subject}.0${expiresAt}.${mac}`,
            `${subject}.${expiresAt}.${mac}.extra`,
            `${subject}.soon.${mac}`
        ]) {
            await refused(maps, ticket);
        }
        const unprefixed = await maps.request('/v1/style?theme=light', { ticket: null, headers: { authorization: await maps.ticket() } });
        expect(unprefixed.status).toBe(401);
    });
});

describe('before anything is asked of TomTom', () => {
    test('health answers without a ticket and says nothing about the configuration', async () => {
        const maps = harness({ TOMTOM_API_KEY: undefined });
        const response = await maps.request('/health', { ticket: null });
        expect(await response.json()).toEqual({ ok: true });
        expect(maps.upstream).toEqual([]);
    });

    test('without the TomTom key, the secret or a long enough secret it says it is not configured', async () => {
        for (const env of [{ TOMTOM_API_KEY: undefined }, { MAP_TICKET_SECRET: undefined }, { MAP_TICKET_SECRET: 'short' }, { TOMTOM_API_KEY: '' }]) {
            const maps = harness(env);
            const response = await maps.request('/v1/style?theme=light');
            expect(response.status).toBe(503);
            expect(await errorCode(response)).toBe('maps-unconfigured');
            expect(maps.upstream).toEqual([]);
        }
    });

    test('a ticket in the query is no ticket: it travels in the header only', async () => {
        const maps = harness();
        const ticket = await maps.ticket();
        expect((await maps.request(`/v1/style?theme=light&t=${ticket}`, { ticket: null })).status).toBe(401);
    });

    test('the rate limit counts the subject of the ticket, never the account, and refuses with a retry', async () => {
        const maps = harness();
        await maps.request('/v1/style?theme=light');
        expect(maps.limited).toHaveLength(1);
        expect(maps.limited[0]).toMatch(/^[A-Za-z0-9_-]{43}$/);
        expect(maps.limited[0]).not.toContain('account-1');
        maps.refuse = true;
        const response = await maps.request('/v1/style?theme=light');
        expect(response.status).toBe(429);
        expect(response.headers.get('retry-after')).toBe('60');
        expect(await errorCode(response)).toBe('rate-limited');
        expect(maps.upstream).toHaveLength(1);
    });
});

describe('the style', () => {
    test('is fetched with the key, and leaves with every address its own and no key anywhere', async () => {
        const maps = harness();
        maps.answers = [() => json(TOMTOM_STYLE)];
        const response = await maps.request('/v1/style?theme=dark');
        expect(response.status).toBe(200);
        expect(maps.upstream[0]!.url).toBe(`https://api.tomtom.com/maps/orbis/assets/styles/0.6.*/style?apiVersion=1&map=basic_street-dark&key=${KEY}`);
        const text = await response.text();
        expect(text).not.toContain(KEY);
        expect(text).not.toContain('key=');
        expect(text).not.toContain('tomtom.com');
        const style = JSON.parse(text);
        expect(style.sprite).toMatch(new RegExp(`^${ORIGIN}/v1/m/[A-Za-z0-9_-]+\\.[A-Za-z0-9_-]{43}/sprite$`));
        expect(style.glyphs).toMatch(/\/v1\/m\/[^/]+\/\{fontstack\}\/\{range\}\.pbf$/);
        expect(style.sources.vector.tiles[0]).toMatch(/\/v1\/m\/[^/]+\/\{z\}\/\{x\}\/\{y\}$/);
        expect(style.sources.tilejson.url).toMatch(/\/v1\/m\/[^/]+\/tilejson$/);
        expect(style.sources.vector.attribution).toBe('TomTom');
        expect(style.layers).toEqual(TOMTOM_STYLE.layers);
    });

    test('light and dark are the two monochrome maps, and anything else is a bad request', async () => {
        const maps = harness();
        maps.answers = [() => json(TOMTOM_STYLE)];
        await maps.request('/v1/style?theme=light');
        expect(maps.upstream[0]!.url).toContain('map=basic_street-light');
        for (const path of ['/v1/style', '/v1/style?theme=sepia', '/v1/style?theme=basic_street-light']) {
            const response = await maps.request(path);
            expect(response.status).toBe(400);
        }
        expect(maps.upstream).toHaveLength(1);
    });

    test('an address the style names that this service does not serve is blanked, wherever it stands', async () => {
        const maps = harness();
        const odd = {
            ...TOMTOM_STYLE,
            sprite: `https://api.tomtom.com/search/2/geocode/x.json?key=${KEY}`,
            glyphs: `https://api.tomtom.com/maps/orbis/assets/fonts/%2e%2e/{fontstack}/{range}.pbf?key=${KEY}`,
            metadata: { docs: `https://api.tomtom.com/maps/orbis/map-display/tile/1/1/1?key=${KEY}`, list: [`https://api.tomtom.com/routing`] },
            sources: {
                vector: {
                    type: 'vector',
                    tiles: [`https://api.tomtom.com/maps/orbis/map-display/tile/{z}/{x}/{y}/{extra}?key=${KEY}`, TILES],
                    attribution: 'https://api.tomtom.com/x'
                },
                tilejson: { type: 'vector', url: 5 }
            }
        };
        maps.answers = [() => json(odd)];
        const text = await (await maps.request('/v1/style?theme=light')).text();
        expect(text).not.toContain('tomtom.com');
        expect(text).not.toContain(KEY);
        const style = JSON.parse(text);
        expect(style.sprite).toBe('');
        expect(style.glyphs).toBe('');
        expect(style.metadata).toEqual({ docs: '', list: [''] });
        expect(style.sources.vector.tiles[0]).toBe('');
        expect(style.sources.vector.tiles[1]).toMatch(/\/\{z\}\/\{x\}\/\{y\}$/);
        expect(style.sources.vector.attribution).toBe('');
        expect(style.sources.tilejson.url).toBe(5);
    });

    test('sources that are not a map of sources are blanked like any other field', async () => {
        const maps = harness();
        maps.answers = [() => json({ version: 8, sources: [TILEJSON.replace(`?key=${KEY}`, '')] })];
        const style = await (await maps.request('/v1/style?theme=light')).json();
        expect(style).toEqual({ version: 8, sources: [''] });
    });

    test('a body that still holds the key after the rewrite is not passed on', async () => {
        const maps = harness();
        maps.answers = [() => json({ version: 8, name: `made with ${KEY}` })];
        const response = await maps.request('/v1/style?theme=light');
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain(KEY);
    });
});

describe('the query of an address the style names', () => {
    async function rewritten(maps: Maps, tiles: string): Promise<string> {
        maps.answers = [() => json({ ...TOMTOM_STYLE, sources: { vector: { type: 'vector', tiles: [tiles] } } })];
        const style = (await (await maps.request('/v1/style?theme=light')).json()) as { sources: { vector: { tiles: string[] } } };
        maps.upstream.length = 0;
        return style.sources.vector.tiles[0]!;
    }

    const TILE = 'https://api.tomtom.com/maps/orbis/map-display/tile/{z}/{x}/{y}';

    test.each([
        {
            name: 'is kept as TomTom wrote it: percent-encoding stays, a value may hold an equals sign, only the key is left out',
            query: `apiVersion=2&layers=a%2Cb%20c&filter=x=1=2&key=${KEY}&view=Unified`,
            tail: '3/4/5',
            expected: `https://api.tomtom.com/maps/orbis/map-display/tile/3/4/5?apiVersion=2&layers=a%2Cb%20c&filter=x=1=2&view=Unified&key=${KEY}`
        },
        {
            name: 'is split at the first question mark and the first equals sign, so no later part is lost',
            query: 'token=abc==&k=a=b',
            tail: '1/1/1',
            expected: `https://api.tomtom.com/maps/orbis/map-display/tile/1/1/1?token=abc==&k=a=b&key=${KEY}`
        }
    ])('$name', async ({ query, tail, expected }) => {
        const maps = harness();
        const tiles = await rewritten(maps, `${TILE}?${query}`);
        expect(tiles).not.toBe('');
        maps.answers = [() => new Response('t', { headers: { 'content-type': 'application/x-protobuf' } })];
        await maps.request(pathOf(tiles).replace('{z}/{x}/{y}', tail));
        expect(maps.upstream[0]!.url).toBe(expected);
    });

    test('an address with a character TomTom does not write in a query is not served', async () => {
        const maps = harness();
        for (const query of ['a=b?c', 'a=<script>', 'a=b c', 'a=\\x', 'a=b#c', 'a="q"']) {
            expect(await rewritten(maps, `${TILE}?${query}`), query).toBe('');
        }
    });

    test('an address that holds the key, in its path or in any value, plain or percent-encoded, is not served', async () => {
        const maps = harness();
        const encoded = KEY.replaceAll('-', '%2D');
        for (const address of [
            `${TILE}?apiVersion=2&token=${KEY}`,
            `${TILE}?apiVersion=2&token=x${KEY}y`,
            `${TILE}?${KEY}=1`,
            `${TILE}?token=${encoded}`,
            `${TILE.replace('/tile/', `/tile-${KEY}/`)}?apiVersion=2`,
            `${TILE}?token=${[...KEY].map((char) => `%${char.charCodeAt(0).toString(16)}`).join('')}`
        ]) {
            expect(await rewritten(maps, address), address).toBe('');
        }
        // A key as the `key` parameter is the one thing taken out, and the rest is served.
        expect(await rewritten(maps, `${TILE}?apiVersion=2&key=${KEY}`)).not.toBe('');
    });
});

describe('what the style names', () => {
    test('a tile is fetched with the key and nothing of the client, and arrives as the bytes TomTom sent', async () => {
        const maps = harness();
        const { tiles } = await styled(maps);
        const bytes = new Uint8Array([0x1a, 0x02, 0x08, 0x01]);
        maps.answers = [() => new Response(bytes, { headers: { 'content-type': 'image/pbf', 'set-cookie': 'a=b', 'access-control-allow-origin': '*' } })];
        const response = await maps.request(pathOf(tiles).replace('{z}/{x}/{y}', '12/2105/1348'), {
            headers: {
                cookie: 'session=1',
                referer: 'https://page.test/',
                'user-agent': 'Mozilla',
                'x-forwarded-for': '203.0.113.9',
                'cf-connecting-ip': '203.0.113.9',
                origin: 'app://ruimte'
            }
        });
        expect(new Uint8Array(await response.arrayBuffer())).toEqual(bytes);
        expect(response.headers.get('content-type')).toBe('image/pbf');
        expect(response.headers.get('set-cookie')).toBeNull();
        expect(response.headers.get('access-control-allow-origin')).toBe('app://ruimte');
        const [call] = maps.upstream;
        expect(call!.url).toBe(`https://api.tomtom.com/maps/orbis/map-display/tile/12/2105/1348?apiVersion=2&key=${KEY}`);
        expect([...call!.headers.keys()].toSorted()).toEqual(['accept', 'user-agent']);
        expect(call!.headers.get('user-agent')).toBe('ruimte-maps');
    });

    test('a query a client adds is never forwarded, and the key it names is never used', async () => {
        const maps = harness();
        const { tiles } = await styled(maps);
        maps.answers = [() => new Response('t', { headers: { 'content-type': 'application/x-protobuf' } })];
        await maps.request(`${pathOf(tiles).replace('{z}/{x}/{y}', '1/1/1')}?key=attacker&apiVersion=9&extra=1`);
        expect(maps.upstream[0]!.url).toBe(`https://api.tomtom.com/maps/orbis/map-display/tile/1/1/1?apiVersion=2&key=${KEY}`);
    });

    test('a sprite, its retina twin and its index are fetched under the address the style named', async () => {
        const maps = harness();
        const { sprite } = await styled(maps);
        const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
        maps.answers = [
            () => new Response(png, { headers: { 'content-type': 'image/png' } }),
            () => new Response(png, { headers: { 'content-type': 'image/png' } }),
            () => json({ marker: { x: 0, y: 0, width: 12, height: 12, pixelRatio: 1 } })
        ];
        for (const suffix of ['.png', '@2x.png', '@2x.json']) {
            const response = await maps.request(`${pathOf(sprite)}${suffix}`);
            expect(response.status, suffix).toBe(200);
        }
        expect(maps.upstream.map((call) => call.url)).toEqual([
            `https://api.tomtom.com/maps/orbis/assets/sprites/1.0.0/basic_mono-light/sprite.png?apiVersion=1&key=${KEY}`,
            `https://api.tomtom.com/maps/orbis/assets/sprites/1.0.0/basic_mono-light/sprite@2x.png?apiVersion=1&key=${KEY}`,
            `https://api.tomtom.com/maps/orbis/assets/sprites/1.0.0/basic_mono-light/sprite@2x.json?apiVersion=1&key=${KEY}`
        ]);
        for (const suffix of ['', '@5x.png', '@2x.svg', '.png/../../x', '@2x.png/']) {
            maps.upstream.length = 0;
            expect((await maps.request(`${pathOf(sprite)}${suffix}`)).status, suffix).toBe(404);
            expect(maps.upstream).toEqual([]);
        }
    });

    test('a glyph range is fetched for a font stack with spaces and commas, as a client writes it', async () => {
        const maps = harness();
        const { glyphs } = await styled(maps);
        maps.answers = [() => new Response(new Uint8Array([1]), { headers: { 'content-type': 'application/x-protobuf' } })];
        const base = pathOf(glyphs);
        for (const stack of [
            'Noto%20Sans%20Regular',
            'Noto%20Sans%20Regular%2CNoto%20Sans%20Italic',
            'Noto%20Sans%20Regular,Noto%20Sans%20Italic',
            'Open-Sans_Bold.v2'
        ]) {
            const path = base.replace('{fontstack}', stack).replace('{range}', '0-255');
            expect((await maps.request(path)).status, stack).toBe(200);
        }
        expect(maps.upstream.map((call) => call.url.split('?')[0])).toEqual([
            'https://api.tomtom.com/maps/orbis/assets/fonts/1.0.0/Noto%20Sans%20Regular/0-255.pbf',
            'https://api.tomtom.com/maps/orbis/assets/fonts/1.0.0/Noto%20Sans%20Regular%2CNoto%20Sans%20Italic/0-255.pbf',
            'https://api.tomtom.com/maps/orbis/assets/fonts/1.0.0/Noto%20Sans%20Regular,Noto%20Sans%20Italic/0-255.pbf',
            'https://api.tomtom.com/maps/orbis/assets/fonts/1.0.0/Open-Sans_Bold.v2/0-255.pbf'
        ]);
    });

    test('a TileJSON is fetched and its tile addresses come back as grants too', async () => {
        const maps = harness();
        const { tilejson } = await styled(maps);
        maps.answers = [() => json({ tiles: [TILES], minzoom: 0 })];
        const response = await maps.request(pathOf(tilejson));
        const body = (await response.json()) as { tiles: string[] };
        expect(body.tiles[0]).toMatch(/\/v1\/m\/[^/]+\/\{z\}\/\{x\}\/\{y\}$/);
        expect(JSON.stringify(body)).not.toContain('tomtom.com');
        expect(maps.upstream[0]!.url).toBe(`https://api.tomtom.com/maps/orbis/map-display/tile.json?key=${KEY}`);
    });

    test('a tail that is not what the grant fills never reaches TomTom: dots, encodings, slashes and backslashes', async () => {
        const maps = harness();
        const { tiles, glyphs } = await styled(maps);
        const tile = pathOf(tiles).replace('/{z}/{x}/{y}', '');
        const font = pathOf(glyphs).replace('/{fontstack}/{range}.pbf', '');
        const attempts = [
            `${tile}/../../../search/2/geocode/x.json`,
            `${tile}/%2e%2e/%2e%2e/%2e%2e/search/2/geocode/x.json`,
            `${tile}/%252e%252e/%252e%252e/%252e%252e/search/2/geocode/x.json`,
            `${tile}/12/%2f/1`,
            `${tile}/12%2f2105%2f1348`,
            `${tile}/12/2105/1348/`,
            `${tile}/12/2105/1348/extra`,
            `${tile}/12/2105`,
            `${tile}//12/2105/1348`,
            `${tile}/a/b/c`,
            `${tile}/12/2105/1348.pbf`,
            `${tile}/%31%32/2105/1348`,
            `${tile}/12/2105/1348%00`,
            `${font}/%2e%2e%2f%2e%2e/0-255.pbf`,
            `${font}/Noto%252E/0-255.pbf`,
            `${font}/Noto%2f..%2f/0-255.pbf`,
            `${font}/Noto%20Sans/0-255.png`,
            `${font}/Noto/0-255`,
            `${font}/../0-255.pbf`,
            `${font}/Noto%00/0-255.pbf`,
            `${font}/Noto%5C/0-255.pbf`
        ];
        for (const path of attempts) {
            const response = await maps.request(path);
            expect(response.status, path).toBe(404);
        }
        expect(maps.upstream).toEqual([]);
    });

    test('a grant this service did not make, or changed, or made for a path it does not serve, is not served', async () => {
        const maps = harness();
        const { tiles } = await styled(maps);
        const [payload, mark] = pathOf(tiles).split('/')[3]!.split('.') as [string, string];
        const text = (value: string): string => Buffer.from(value, 'base64url').toString('utf8');
        const changed = Buffer.from(text(payload).replace('display', 'display/..'), 'utf8').toString('base64url');
        const outside = Buffer.from(JSON.stringify({ k: 'tile', p: 'search/2/geocode/{z}/{x}/{y}', q: [] }), 'utf8').toString('base64url');
        const own = await signMapsPath(SECRET, outside);
        const foreign = await signMapsPath('Zk3mQ8vJx1LpT5aRn0cWy7DbHfUe2GsOi9NtV4Xr6Ml', payload);
        for (const token of [
            `${changed}.${mark}`,
            `${payload}.${'A'.repeat(43)}`,
            `${payload}.${foreign}`,
            `${outside}.${own}`,
            payload,
            `${payload}.${mark}.x`,
            `.${mark}`,
            ''
        ]) {
            expect((await maps.request(`/v1/m/${token}/1/1/1`)).status, token).toBe(404);
        }
        expect((await maps.request('/v1/m/nonsense')).status).toBe(404);
        expect((await maps.request('/v1/map/maps/orbis/map-display/tile/1/1/1')).status).toBe(404);
        expect((await maps.request('/v1/tile/1/1/1')).status).toBe(404);
        expect(maps.upstream).toEqual([]);
    });

    test('the one open door of before stays shut: a double encoded path to another TomTom service', async () => {
        const maps = harness();
        const response = await maps.request('/v1/map/maps/orbis/display/%252e%252e/%252e%252e/%252e%252e/search/2/geocode/x.json');
        expect(response.status).toBe(404);
        expect(maps.upstream).toEqual([]);
    });

    test('what TomTom refuses with is never repeated to the client', async () => {
        const cases: [number, number, string][] = [
            [404, 404, 'not-found'],
            [429, 429, 'rate-limited'],
            [403, 502, 'upstream'],
            [500, 502, 'upstream']
        ];
        for (const [from, status, code] of cases) {
            const maps = harness();
            const { tiles } = await styled(maps);
            maps.answers = [() => new Response(`denied for key ${KEY}`, { status: from })];
            const response = await maps.request(pathOf(tiles).replace('{z}/{x}/{y}', '1/1/1'));
            expect(response.status).toBe(status);
            expect(await errorCode(response.clone())).toBe(code);
            expect(await response.text()).not.toContain(KEY);
        }
        const maps = harness();
        const { tiles } = await styled(maps);
        maps.answers = [
            () => {
                throw new Error(`network down for ${KEY}`);
            }
        ];
        const response = await maps.request(pathOf(tiles).replace('{z}/{x}/{y}', '1/1/1'));
        expect(response.status).toBe(502);
        expect(await response.text()).not.toContain(KEY);
    });

    test('a body of a kind it does not know is refused, and a body that holds the key is not passed on', async () => {
        const maps = harness();
        const { tiles } = await styled(maps);
        const tile = pathOf(tiles).replace('{z}/{x}/{y}', '1/1/1');
        for (const headers of [{ 'content-type': 'text/html' }, { 'content-type': 'text/plain' }, { 'content-type': 'application/xml' }, {}]) {
            maps.answers = [() => new Response(`<html>${KEY}</html>`, { headers })];
            const response = await maps.request(tile);
            expect(response.status).toBe(502);
            expect(await response.text()).not.toContain(KEY);
        }
        maps.answers = [() => json({ note: `see ${KEY}` })];
        expect((await maps.request(tile)).status).toBe(502);
        maps.answers = [() => new Response(new Uint8Array([1]), { headers: { 'content-type': 'image/webp' } })];
        expect((await maps.request(tile)).status).toBe(200);
    });
});

describe('a redirect from TomTom', () => {
    test('is not followed and not passed on: a 3xx fails closed', async () => {
        const maps = harness();
        const { tiles } = await styled(maps);
        maps.answers = [() => new Response(null, { status: 302, headers: { location: 'https://evil.test/tile' } })];
        const tile = await maps.request(pathOf(tiles).replace('{z}/{x}/{y}', '1/1/1'));
        expect(maps.upstream).toHaveLength(1);
        expect(maps.upstream[0]!.redirect).toBe('manual');
        expect(tile.status).toBe(502);
        expect(tile.headers.get('location')).toBeNull();
    });

    test('every request to TomTom uses fetch options workerd accepts', async () => {
        expect(() => assertWorkerdFetchOptions({ redirect: 'error' })).toThrow('must be one of "follow" or "manual"');
        const maps = harness();
        await maps.request('/v1/style?theme=light');
        expect(maps.upstream.length).toBe(1);
    });
});

describe('the edge cache', () => {
    async function tile(maps: Maps): Promise<string> {
        const { tiles } = await styled(maps);
        return pathOf(tiles).replace('{z}/{x}/{y}', '12/2105/1348');
    }

    test('keeps a response for no longer than TomTom says, under a key with neither ticket nor key in it', async () => {
        const maps = harness();
        const path = await tile(maps);
        maps.cached.clear();
        maps.answers = [() => new Response('tile', { headers: { 'content-type': 'application/x-protobuf', 'cache-control': 'public, max-age=3600' } })];
        const first = await maps.request(path);
        expect(first.headers.get('cache-control')).toBe('private, max-age=3600');
        expect(await first.text()).toBe('tile');
        expect([...maps.cached.keys()]).toEqual(['https://cache.maps.invalid/maps/orbis/map-display/tile/12/2105/1348?apiVersion=2']);
        const stored = [...maps.cached.values()][0]!;
        expect(stored.headers.get('cache-control')).toBe('public, max-age=3600');
        for (const url of maps.cached.keys()) {
            expect(url).not.toContain(KEY);
            expect(url).not.toContain('Bearer');
        }
        // Another account asks for it later, from the cache.
        maps.now += 1_800_000;
        const second = await maps.request(path, { ticket: await maps.ticket('account-2') });
        expect(await second.text()).toBe('tile');
        expect(second.headers.get('cache-control')).toBe('private, max-age=1800');
        expect(maps.upstream).toHaveLength(1);
        // Past TomTom's own limit it asks again.
        maps.now += 1_801_000;
        await maps.request(path);
        expect(maps.upstream).toHaveLength(2);
    });

    test('keeps nothing TomTom did not allow keeping: no header, no-store, private or an age past its life', async () => {
        for (const headers of [{}, { 'cache-control': 'no-store' }, { 'cache-control': 'private, max-age=60' }, { 'cache-control': 'max-age=60', age: '60' }]) {
            const maps = harness();
            const path = await tile(maps);
            maps.cached.clear();
            maps.answers = [() => new Response('tile', { headers: { 'content-type': 'application/x-protobuf', ...headers } })];
            const response = await maps.request(path);
            expect(response.headers.get('cache-control')).toBe('no-store');
            expect(maps.cached.size).toBe(0);
        }
    });

    test('counts the age TomTom reports and prefers s-maxage', async () => {
        const maps = harness();
        const path = await tile(maps);
        maps.answers = [
            () => new Response('tile', { headers: { 'content-type': 'application/x-protobuf', 'cache-control': 'max-age=60, s-maxage=600', age: '100' } })
        ];
        const response = await maps.request(path);
        expect(response.headers.get('cache-control')).toBe('private, max-age=500');
    });

    test('keeps a rewritten style, not the one TomTom sent', async () => {
        const maps = harness();
        maps.answers = [() => json(TOMTOM_STYLE, { 'cache-control': 'max-age=600' })];
        await maps.request('/v1/style?theme=light');
        const stored = await [...maps.cached.values()][0]!.text();
        expect(stored).not.toContain(KEY);
        expect(stored).not.toContain('tomtom.com');
    });
});

describe('a search', () => {
    test('has no route, so nothing can spend Search quota', async () => {
        const maps = harness();
        const response = await maps.request('/v1/geocode', { method: 'POST', body: JSON.stringify({ query: 'Utrecht' }) });
        expect(response.status).toBe(404);
        expect(maps.upstream).toEqual([]);
    });
});

describe('who may read the answers', () => {
    test('the desktop app, loopback and the listed web client may, and a preflight needs no ticket', async () => {
        const maps = harness();
        for (const origin of ['app://ruimte', 'http://localhost:5173', 'http://127.0.0.1:4210', 'https://station.test']) {
            const response = await maps.request('/v1/style?theme=light', { method: 'OPTIONS', headers: { origin }, ticket: null });
            expect(response.status).toBe(204);
            expect(response.headers.get('access-control-allow-origin')).toBe(origin);
            expect(response.headers.get('access-control-allow-headers')).toContain('authorization');
        }
        const other = await maps.request('/v1/style?theme=light', { method: 'OPTIONS', headers: { origin: 'https://evil.test' }, ticket: null });
        expect(other.headers.get('access-control-allow-origin')).toBeNull();
        expect(maps.upstream).toEqual([]);
    });

    test('a refusal carries the headers too, so the page can read why', async () => {
        const maps = harness();
        const response = await maps.request('/v1/style?theme=light', { headers: { origin: 'app://ruimte' }, ticket: null });
        expect(response.status).toBe(401);
        expect(response.headers.get('access-control-allow-origin')).toBe('app://ruimte');
    });
});
