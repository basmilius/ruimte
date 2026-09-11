import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readOrCreateEndpointId } from './endpoint-id.ts';

let home: string;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
});

afterEach(async () => {
    await rm(home, { recursive: true, force: true });
});

describe('readOrCreateEndpointId', () => {
    test('mints an id once and answers with the same one after that', async () => {
        const first = await readOrCreateEndpointId(home);
        expect(first.length).toBeGreaterThan(8);
        expect(await readOrCreateEndpointId(home)).toBe(first);

        const written = JSON.parse(await readFile(join(home, 'endpoint.json'), 'utf8')) as { version: number; id: string };
        expect(written).toEqual({ version: 1, id: first });
    });

    test('mints a new id in a home that has none, so two homes are two machines', async () => {
        const other = await mkdtemp(join(tmpdir(), 'ruimte-endpoint-id-'));
        try {
            expect(await readOrCreateEndpointId(other)).not.toBe(await readOrCreateEndpointId(home));
        } finally {
            await rm(other, { recursive: true, force: true });
        }
    });

    test('replaces a file that will not parse instead of failing to start', async () => {
        await writeFile(join(home, 'endpoint.json'), '{ not json');
        const minted = await readOrCreateEndpointId(home);
        expect(minted.length).toBeGreaterThan(8);
        expect(await readOrCreateEndpointId(home)).toBe(minted);
    });

    test('creates the home directory when the daemon has never written there', async () => {
        const fresh = join(home, 'nested', 'home');
        const minted = await readOrCreateEndpointId(fresh);
        expect(await readFile(join(fresh, 'endpoint.json'), 'utf8')).toContain(minted);
    });
});
