import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareShadowHome } from './shadow-home.ts';

describe('prepareShadowHome', () => {
    let dir: string;
    let home: string;
    let shadow: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'ruimte-shadow-'));
        home = join(dir, 'codex');
        shadow = join(dir, 'codex_personal');
        await mkdir(join(home, 'sessions'), { recursive: true });
        await mkdir(shadow);
        await writeFile(join(home, 'config.toml'), 'cli_auth_credentials_store = "file"\n');
        await writeFile(join(home, 'auth.json'), '{}');
        await writeFile(join(home, 'models_cache.json'), '{}');
        await writeFile(join(home, 'state_5.sqlite'), '');
        await writeFile(join(home, 'state_5.sqlite-wal'), '');
        await mkdir(join(home, 'app-server-daemon'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('links what the accounts share and keeps the login and the caches out', async () => {
        const report = await prepareShadowHome(home, shadow);
        expect(report.linked).toEqual(['archived_sessions', 'config.toml', 'rules', 'sessions', 'skills', 'state_5.sqlite']);
        expect(report.unshared).toEqual([]);
        expect(report.sharedLogin).toBe(false);
        expect(await readlink(join(shadow, 'sessions'))).toBe(join(home, 'sessions'));
        expect(await readFile(join(shadow, 'config.toml'), 'utf8')).toContain('cli_auth_credentials_store');
        for (const name of ['auth.json', 'models_cache.json', 'state_5.sqlite-wal', 'app-server-daemon']) {
            expect(lstat(join(shadow, name))).rejects.toThrow();
        }
    });

    test('runs again without touching what is there, and links what the home gained since', async () => {
        await prepareShadowHome(home, shadow);
        await writeFile(join(home, 'AGENTS.md'), '# mine');
        const report = await prepareShadowHome(home, shadow);
        expect(report.linked).toEqual(['AGENTS.md']);
    });

    test('never replaces a real file or a link that points elsewhere', async () => {
        await writeFile(join(shadow, 'config.toml'), 'model = "own"\n');
        await symlink(join(dir, 'elsewhere'), join(shadow, 'sessions'));
        const report = await prepareShadowHome(home, shadow);
        expect(report.unshared).toEqual(['config.toml', 'sessions']);
        expect(await readFile(join(shadow, 'config.toml'), 'utf8')).toBe('model = "own"\n');
        expect(await readlink(join(shadow, 'sessions'))).toBe(join(dir, 'elsewhere'));
    });

    test('says so when the login of the shadow home is a link to another one', async () => {
        await symlink(join(home, 'auth.json'), join(shadow, 'auth.json'));
        expect((await prepareShadowHome(home, shadow)).sharedLogin).toBe(true);
    });

    test('refuses a shadow home that is the home itself', async () => {
        expect(prepareShadowHome(home, `${home}/`)).rejects.toThrow('another folder');
    });
});
