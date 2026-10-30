import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher, type ClientAccess } from '../dispatcher.ts';
import { askOnce } from './test-helpers.ts';
import { CustomLanguageServers } from '../language/custom.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { LanguageHost } from '../language/host.ts';
import { KIND_PROFILES } from '../language/profiles.ts';
import { fakeSpawner } from '../language/test-fakes.ts';
import { registerLanguageHandlers } from './language.ts';

let root: string;
let dispatcher: Dispatcher;

beforeEach(async () => {
    // The project folder holds the home, the way a person who opens their own home folder has it.
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-language-handlers-')));
    const home = join(root, 'ruimte-home');
    await mkdir(join(home, 'scratch'), { recursive: true });
    await writeFile(join(home, 'endpoint.json'), '{}');
    await writeFile(join(home, 'scratch', 'notes.md'), '# Notes');
    dispatcher = new Dispatcher();
    const host = new LanguageHost({
        root: join(home, 'language-servers'),
        folderOf: (projectId) => (projectId === 'p1' ? root : null),
        holders: () => [],
        machineHome: new MachineHome(home),
        spawn: fakeSpawner().spawn,
        findProgram: () => [],
        custom: new CustomLanguageServers({
            path: join(home, 'language-servers', 'custom.json'),
            resolve: (command) => (command === 'zls' ? '/bin/zls' : null)
        })
    });
    host.subscribe('client-1', () => undefined);
    registerLanguageHandlers(dispatcher, host);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

const OWNER: ClientAccess = { reachability: 'loopback', sessionId: null };
const GUEST: ClientAccess = { reachability: 'lan', sessionId: 'session-1' };

function call(type: string, payload: unknown, access?: ClientAccess): Promise<ServerFrame> {
    return askOnce(dispatcher, { id: 'client-1', access }, type, payload);
}

describe('language handlers', () => {
    test('the files a client may read are the files it may open, and the machine state is not among them', async () => {
        const base = { projectId: 'p1', languageId: 'markdown', text: '' };
        expect(await call('language.document.open', { ...base, path: 'ruimte-home/scratch/notes.md' })).toMatchObject({ ok: true, result: { version: 1 } });
        expect(await call('language.document.open', { ...base, path: 'ruimte-home/endpoint.json' })).toMatchObject({ ok: false, error: { code: 'bad-path' } });
        expect(await call('language.document.open', { ...base, path: join(root, 'ruimte-home', 'endpoint.json') })).toMatchObject({
            ok: false,
            error: { code: 'bad-path' }
        });
    });

    test('a stale change answers under the code the client recognizes', async () => {
        await call('language.document.open', { projectId: 'p1', path: 'a.md', languageId: 'markdown', text: 'x' });
        expect(await call('language.document.change', { projectId: 'p1', path: 'a.md', baseVersion: 3, changes: [{ text: 'y' }] })).toMatchObject({
            ok: false,
            error: { code: 'stale-document' }
        });
        expect(await call('language.document.change', { projectId: 'p1', path: 'a.md', baseVersion: 1, changes: [{ text: 'y' }] })).toMatchObject({
            ok: true,
            result: { version: 2 }
        });
    });

    test('a save notice for a document that is open is accepted, and for one that is not refused', async () => {
        const target = { projectId: 'p1', path: 'a.md' };

        expect(await call('language.willSave', { ...target, reason: 1 })).toMatchObject({ ok: false, error: { code: 'document-not-open' } });

        await call('language.document.open', { ...target, languageId: 'markdown', text: 'x' });

        expect(await call('language.willSave', { ...target, reason: 1 })).toMatchObject({ ok: false, error: { code: 'language-unavailable' } });
        expect(await call('language.willSave', { ...target, reason: 7 })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    });

    test('an answer to a message nobody waits on is accepted and does nothing, and any client may switch a trace', async () => {
        expect(await call('language.messageAnswer', { projectId: 'p1', messageId: 'message-9', action: null }, GUEST)).toMatchObject({ ok: true, result: {} });
        expect(await call('language.trace', { projectId: 'p1', server: 'css', value: 'verbose' }, GUEST)).toMatchObject({
            ok: false,
            error: { code: 'language-unavailable' }
        });
        expect(await call('language.trace', { projectId: 'p1', server: 'css', value: 'loud' }, GUEST)).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
    });

    test('a whole-project check of a project without a running server answers that nothing answered', async () => {
        expect(await call('language.workspaceProblems', { projectId: 'p1' })).toMatchObject({ ok: true, result: { servers: [], files: 0 } });
    });

    test('a method outside the list is refused before it reaches a server', async () => {
        expect(await call('language.request', { projectId: 'p1', path: 'a.ts', method: 'workspace/executeCommand', params: {} })).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
    });

    test('the status of a project lists every kind, none installed on a fresh machine', async () => {
        const reply = await call('language.status', { projectId: 'p1' });
        expect(reply).toMatchObject({ ok: true });
        expect((reply as { result: { servers: { server: string; state: string }[] } }).result.servers.map((status) => [status.server, status.state])).toEqual(
            Object.keys(KIND_PROFILES).map((kind) => [kind, 'not-installed'])
        );
    });

    test('a kind with no alternative is refused, and so is a retired one a client can still name', async () => {
        expect(await call('language.prefer', { server: 'css' })).toMatchObject({ ok: false, error: { code: 'invalid-server' } });
        expect(await call('language.prefer', { server: 'php' })).toMatchObject({ ok: false, error: { code: 'invalid-server' } });
        expect(await call('language.install', { server: 'php' })).toMatchObject({ ok: false, error: { code: 'invalid-server' } });
    });

    test('a step back needs an earlier version to go back to', async () => {
        expect(await call('language.rollback', { server: 'css' })).toMatchObject({ ok: false, error: { code: 'language-failed' } });
        expect(await call('language.rollback', { server: 'nope' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    });
});

describe('language servers of a person', () => {
    const zig = { name: 'Zig', command: 'zls', args: [], languages: ['zig'], patterns: [] };

    test('only the owner of the machine saves, removes or probes one, and anyone may list them', async () => {
        for (const access of [undefined, GUEST]) {
            expect(await call('language.custom.save', { server: zig }, access)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
            expect(await call('language.custom.remove', { id: 'custom:a' }, access)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
            expect(await call('language.custom.check', { command: 'zls' }, access)).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        }
        expect(await call('language.custom.list', {}, GUEST)).toMatchObject({ ok: true, result: { servers: [] } });
    });

    test('saves, lists and removes a server, and says why one cannot be saved', async () => {
        expect(await call('language.custom.check', { command: 'zls' }, OWNER)).toMatchObject({ ok: true, result: { found: true, path: '/bin/zls' } });
        expect(await call('language.custom.check', { command: 'nope' }, OWNER)).toMatchObject({ ok: true, result: { found: false } });
        expect(await call('language.custom.save', { server: { ...zig, command: 'nope' } }, OWNER)).toMatchObject({
            ok: false,
            error: { code: 'invalid-server' }
        });
        expect(await call('language.custom.save', { server: { ...zig, languages: [], patterns: [] } }, OWNER)).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
        const saved = await call('language.custom.save', { server: zig }, OWNER);
        expect(saved).toMatchObject({ ok: true, result: { server: { name: 'Zig', command: 'zls' } } });
        const id = (saved as { result: { server: { id: string } } }).result.server.id;
        expect(await call('language.custom.list', {}, GUEST)).toMatchObject({ result: { servers: [{ id }] } });
        const status = await call('language.status', { projectId: 'p1' });
        expect((status as { result: { servers: { server: string; name?: string; state: string }[] } }).result.servers.at(-1)).toMatchObject({
            server: id,
            name: 'Zig',
            state: 'stopped'
        });
        expect(await call('language.custom.remove', { id }, OWNER)).toMatchObject({ ok: true });
        expect(await call('language.custom.list', {}, OWNER)).toMatchObject({ result: { servers: [] } });
    });
});
