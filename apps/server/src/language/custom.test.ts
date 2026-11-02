import { beforeEach, describe, expect, it } from 'bun:test';
import { readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import type { CustomLanguageServerInput } from '@ruimte/contracts';
import { CustomLanguageServers, customProfile, resolveCommandOnPath } from './custom.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

let root = '';
let path = '';

const newHome = tempHomes('ruimte-custom-servers-');

beforeEach(async () => {
    root = await newHome();
    path = join(root, 'language-servers', 'custom.json');
});

const known = new Set(['zls', '/usr/local/bin/taplo']);
const resolve = (command: string) => (known.has(command) ? `/bin/${command}` : null);
const zig: CustomLanguageServerInput = { name: 'Zig', command: 'zls', args: [], languages: ['zig'], patterns: ['*.zon'] };

function store(): CustomLanguageServers {
    return new CustomLanguageServers({ path, resolve });
}

describe('the language servers of a person', () => {
    it('keeps one server per name for an extension, and a person who edits it makes it theirs', async () => {
        const servers = store();
        await servers.load();

        const first = await servers.saveFor('poc.machine', zig);
        const again = await servers.saveFor('poc.machine', { ...zig, args: ['--stdio'] });
        await servers.saveFor('poc.other', zig);

        expect(again.id).toBe(first.id);
        expect(servers.list()).toHaveLength(2);
        expect(servers.ownedBy('poc.machine')).toEqual([first.id]);

        const reloaded = store();
        await reloaded.load();

        expect(reloaded.list().map((server) => server.held)).toEqual([undefined, undefined]);

        await servers.save({ ...zig, id: first.id });

        expect(servers.ownedBy('poc.machine')).toEqual([]);
        expect((await servers.saveFor('poc.machine', { ...zig, command: 'other', args: [] }).catch(() => null))?.id ?? first.id).toBe(first.id);
    });

    it('saves a server and reads it back after a restart', async () => {
        const first = store();
        await first.load();
        const saved = await first.save({
            ...zig,
            args: ['--stdio'],
            env: { ZLS_LOG: '1' },
            initializationOptions: { enableSnippets: true },
            projects: ['/work/a']
        });
        expect(saved.id.startsWith('custom:')).toBe(true);
        const second = store();
        await second.load();
        expect(second.list()).toEqual([saved]);
        expect(saved).toMatchObject({ args: ['--stdio'], env: { ZLS_LOG: '1' }, initializationOptions: { enableSnippets: true }, projects: ['/work/a'] });
    });

    it('refuses a missing command, a bad pattern and an unknown server id', async () => {
        const servers = store();
        await expect(servers.save({ ...zig, command: 'nope' })).rejects.toMatchObject({ code: 'invalid-server' });
        await expect(servers.save({ ...zig, patterns: ['*.{a,b'] })).rejects.toMatchObject({ code: 'invalid-server' });
        await expect(servers.save({ ...zig, id: 'custom:unknown' })).rejects.toMatchObject({ code: 'invalid-server' });
        expect(servers.list()).toEqual([]);
        expect(servers.check('zls')).toEqual({ found: true, path: '/bin/zls' });
        expect(servers.check('nope')).toEqual({ found: false });
    });

    it('changes a server it knows and removes one', async () => {
        const servers = store();
        const { id } = await servers.save(zig);
        await servers.save({ ...zig, id, name: 'Zig language server', languages: ['Zig', 'zig'] });
        expect(servers.list()).toMatchObject([{ id, name: 'Zig language server', languages: ['zig'] }]);
        expect(await servers.remove(id)).toBe(true);
        expect(await servers.remove(id)).toBe(false);
        expect(servers.list()).toEqual([]);
    });

    it('holds a server whose command was changed in the file by hand until it is saved again', async () => {
        const first = store();
        const { id } = await first.save(zig);
        const file = JSON.parse(await readFile(path, 'utf8')) as { servers: { command: string }[] };
        file.servers[0]!.command = '/tmp/evil';
        await writeFile(path, JSON.stringify(file));
        const second = store();
        await second.load();
        expect(second.list()).toMatchObject([{ id, held: true }]);
        await second.save({ ...zig, id });
        expect(second.list()).toMatchObject([{ id, command: 'zls' }]);
        expect(second.list()[0]!.held).toBeUndefined();
    });

    it('keeps an entry it cannot read, and refuses to write over a file that is no JSON', async () => {
        await Bun.write(path, '{ not json');
        const broken = store();
        await broken.load();
        await expect(broken.save(zig)).rejects.toMatchObject({ code: 'invalid-server' });

        await writeFile(path, JSON.stringify({ servers: [{ future: true }] }));
        const odd = store();
        await odd.load();
        expect(odd.list()).toEqual([]);
        await odd.save(zig);
        expect((JSON.parse(await readFile(path, 'utf8')) as { servers: unknown[] }).servers).toHaveLength(2);
    });

    it('makes a profile that runs the command as it is, by language or by path', async () => {
        const servers = store();
        const saved = await servers.save({ ...zig, args: ['--stdio'], env: { A: 'b' } });
        const [component] = customProfile(saved).components;
        expect(component).toMatchObject({ name: saved.id, title: 'Zig', command: 'zls', languages: ['zig'], patterns: ['*.zon'], env: { A: 'b' } });
        expect(component!.args({ installDirectory: '', projectFolder: '/work', typescriptLib: '', typescriptExecutable: '' })).toEqual(['--stdio']);
    });
});

describe('finding a command', () => {
    it('finds an executable by its absolute path and on the PATH, and nothing relative', () => {
        expect(resolveCommandOnPath(process.execPath)).toBe(process.execPath);
        expect(resolveCommandOnPath('bun')).toMatch(/[\\/]bun(\.exe)?$/);
        expect(resolveCommandOnPath('./bun')).toBeNull();
        expect(resolveCommandOnPath(join(dirname(process.execPath), 'does-not-exist'))).toBeNull();
        expect(resolveCommandOnPath('does-not-exist-anywhere')).toBeNull();
    });
});
