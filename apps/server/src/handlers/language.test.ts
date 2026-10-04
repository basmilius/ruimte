import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { LanguageHost } from '../language/host.ts';
import { fakeSpawner } from '../language/test-fakes.ts';
import { registerLanguageHandlers } from './language.ts';

let root: string;
let dispatcher: Dispatcher;
let frames: ServerFrame[];

beforeEach(async () => {
    // The project folder holds the home, the way a person who opens their own home folder has it.
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-language-handlers-')));
    const home = join(root, 'ruimte-home');
    await mkdir(join(home, 'scratch'), { recursive: true });
    await writeFile(join(home, 'endpoint.json'), '{}');
    await writeFile(join(home, 'scratch', 'notes.md'), '# Notes');
    dispatcher = new Dispatcher();
    registerLanguageHandlers(
        dispatcher,
        new LanguageHost({
            root: join(home, 'language-servers'),
            folderOf: (projectId) => (projectId === 'p1' ? root : null),
            holders: () => [],
            machineHome: new MachineHome(home),
            spawn: fakeSpawner().spawn
        })
    );
    frames = [];
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function call(type: string, payload: unknown): Promise<ServerFrame> {
    await dispatcher.handle({ id: 'client-1', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'r1', type, payload }));
    return frames.at(-1) as ServerFrame;
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

    test('a method outside the list is refused before it reaches a server', async () => {
        expect(await call('language.request', { projectId: 'p1', path: 'a.ts', method: 'workspace/executeCommand', params: {} })).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
    });

    test('the status of a project lists every kind, none installed on a fresh machine', async () => {
        const reply = await call('language.status', { projectId: 'p1' });
        expect(reply).toMatchObject({ ok: true });
        expect((reply as { result: { servers: { server: string; state: string }[] } }).result.servers.map((status) => [status.server, status.state])).toEqual([
            ['typescript', 'not-installed'],
            ['vue', 'not-installed'],
            ['php', 'not-installed']
        ]);
    });
});
