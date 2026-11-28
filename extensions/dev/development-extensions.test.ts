import { describe, expect, test } from 'bun:test';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { developmentExtensions } from '../../apps/server/scripts/dev-extensions.ts';
import { readManifest } from '../../apps/server/src/extensions/pack.ts';

const REPOSITORY = join(import.meta.dir, '..', '..');
// What ships or is packed for the store: every folder with a manifest directly under `extensions`.
const SHIPPED = readdirSync(join(REPOSITORY, 'extensions'), { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && entry.name !== 'dev' && entry.name !== 'poc')
    .flatMap((entry) => {
        try {
            return [readManifest(join(REPOSITORY, 'extensions', entry.name)).id];
        } catch {
            return [];
        }
    });

describe('the development extensions of this repository', () => {
    const found = developmentExtensions(REPOSITORY);
    const ids = found.map((extension) => readManifest(join(REPOSITORY, extension.path)).id);

    test('each have a manifest the machine links, under an id of their own', () => {
        expect(found.length).toBeGreaterThan(0);
        expect(new Set(ids).size).toBe(ids.length);
    });

    test('never take the id of an extension that ships', () => {
        expect(SHIPPED.length).toBeGreaterThan(0);
        expect(ids.filter((id) => SHIPPED.includes(id))).toEqual([]);
    });

    test('hold the ones that break on purpose, off until a person turns them on', () => {
        expect(found.filter((extension) => extension.startsOff).map((extension) => extension.path)).toEqual([
            'extensions/poc/broken',
            'extensions/poc/broken-load'
        ]);
    });
});
