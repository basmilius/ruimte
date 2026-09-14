import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { localSecretPath, readLocalSecret, readOrCreateLocalSecret, sameSecret } from './local-secret.ts';

let root: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-local-secret-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the local secret', () => {
    test('is minted on the first start, readable only by this account, and the same on the next', async () => {
        const home = join(root, 'home');
        expect(await readLocalSecret(home)).toBeNull();

        const first = await readOrCreateLocalSecret(home);
        expect(first.length).toBeGreaterThan(40);
        expect((await stat(localSecretPath(home))).mode & 0o777).toBe(0o600);
        expect((await stat(home)).mode & 0o777).toBe(0o700);

        expect(await readOrCreateLocalSecret(home)).toBe(first);
        expect(await readLocalSecret(home)).toBe(first);
    });

    test('an empty file is no secret, and a new one replaces it', async () => {
        await writeFile(localSecretPath(root), '\n');
        expect(await readLocalSecret(root)).toBeNull();
        expect((await readOrCreateLocalSecret(root)).length).toBeGreaterThan(40);
    });

    test('compares whole values only', () => {
        expect(sameSecret('abc', 'abc')).toBe(true);
        expect(sameSecret('ab', 'abc')).toBe(false);
        expect(sameSecret('', 'abc')).toBe(false);
    });
});
