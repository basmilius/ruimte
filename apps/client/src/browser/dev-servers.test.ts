import { describe, expect, it } from 'bun:test';
import { DEV_SERVER_PORTS, DEV_SERVER_PROBE_PORTS, devServerTiles } from './dev-servers.ts';

const known = [
    { port: 5173, tools: ['Vite'] },
    { port: 3000, tools: ['Next.js', 'Nuxt'] }
];

describe('devServerTiles', () => {
    it('puts what is running first, by port, and the rest in the order of the table', () => {
        const tiles = devServerTiles([{ port: 5173 }], known);
        expect(tiles.map((tile) => [tile.port, tile.running])).toEqual([
            [5173, true],
            [3000, false]
        ]);
    });

    it('names a running server after its page, and a port after the tools that pick it', () => {
        const tiles = devServerTiles([{ port: 5173, title: 'ruimte' }], known);
        expect(tiles[0]).toEqual({ port: 5173, url: 'http://localhost:5173', detail: 'ruimte', running: true });
        expect(tiles[1]!.detail).toBe('Next.js, Nuxt');
    });

    it('falls back to the tools of a running server that has no page title', () => {
        expect(devServerTiles([{ port: 3000 }], known)[0]!.detail).toBe('Next.js, Nuxt');
    });

    it('keeps a port the table does not know', () => {
        const tiles = devServerTiles([{ port: 9999, title: 'thing' }], known);
        expect(tiles[0]).toEqual({ port: 9999, url: 'http://localhost:9999', detail: 'thing', running: true });
        expect(tiles).toHaveLength(3);
    });

    it('asks about every port once, within what one request may carry', () => {
        expect(new Set(DEV_SERVER_PROBE_PORTS).size).toBe(DEV_SERVER_PORTS.length);
        expect(DEV_SERVER_PROBE_PORTS.length).toBeLessThanOrEqual(32);
    });
});
