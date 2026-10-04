import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { LANGUAGE_ERROR_CODES, type LanguageServerKind } from '@ruimte/contracts';
import { CodedError } from '@ruimte/agents/coded-error';
import type { SessionEvent } from '../sessions/manager.ts';
import { LanguageHost } from './host.ts';
import { KIND_PROFILES } from './profiles.ts';
import { fakeSpawner, ManualClock, settle, type FakeSpawner } from './test-fakes.ts';

let root = '';

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-language-host-'));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

class Refused extends CodedError<'machine-state'> {}

interface Rig {
    host: LanguageHost;
    spawner: FakeSpawner;
    holders: Set<string>;
    events: Record<string, SessionEvent[]>;
    installs: LanguageServerKind[];
}

/* The install of a kind is played by `run`, which leaves the scripts where bun would. */
function rig(options: { installed?: LanguageServerKind[]; spawner?: FakeSpawner } = {}): Rig {
    const spawner = options.spawner ?? fakeSpawner();
    const holders = new Set(['client-1']);
    const installs: LanguageServerKind[] = [];
    const host = new LanguageHost({
        root,
        folderOf: (projectId) => (projectId === 'p1' ? '/work' : null),
        holders: () => [...holders],
        machineHome: {
            refuse: async (path) => {
                if (path.startsWith('/home/.ruimte/')) {
                    throw new Refused('machine-state', `${path} belongs to this machine's own state`);
                }
            }
        },
        runtime: { command: '/ruimte', args: [], env: { BUN_BE_BUN: '1' } },
        spawn: spawner.spawn,
        run: async (spec) => {
            const kind = basename(spec.cwd) as LanguageServerKind;
            installs.push(kind);
            for (const component of KIND_PROFILES[kind].components) {
                const entry = join(spec.cwd, 'node_modules', component.entry);
                await mkdir(dirname(entry), { recursive: true });
                await writeFile(entry, '');
            }
            return 0;
        },
        clock: new ManualClock(),
        exists: async () => false
    });
    const events: Record<string, SessionEvent[]> = { 'client-1': [], 'client-2': [] };
    for (const clientId of Object.keys(events)) {
        host.subscribe(clientId, (event) => events[clientId].push(event));
    }
    return { host, spawner, holders, events, installs };
}

async function installed(kinds: LanguageServerKind[] = ['typescript']): Promise<Rig> {
    const result = rig();
    for (const kind of kinds) {
        await result.host.install(kind);
    }
    await settle();
    await until(async () =>
        (await result.host.status('p1')).filter((status) => kinds.includes(status.server as LanguageServerKind)).every((status) => status.state === 'stopped')
    );
    return result;
}

/* Waits on what only real I/O settles, the install check, by looking again each turn of the event loop and never by the clock. */
async function until(check: () => boolean | Promise<boolean>): Promise<void> {
    for (let i = 0; i < 2000; i++) {
        if (await check()) {
            return;
        }
        await new Promise<void>((resolve) => setImmediate(resolve));
    }
    throw new Error('The condition never held');
}

async function ready(host: LanguageHost, server = 'typescript'): Promise<void> {
    await until(async () => (await host.status('p1')).find((status) => status.server === server)?.state === 'ready');
    await settle();
}

async function openReady(host: LanguageHost, path = 'src/a.ts', text = 'let a = 1;\n', clientId = 'client-1', languageId = 'typescript') {
    const result = await open(host, path, text, clientId, languageId);
    await ready(host);
    return result;
}

const open = (host: LanguageHost, path = 'src/a.ts', text = 'let a = 1;\n', clientId = 'client-1', languageId = 'typescript') =>
    host.open(clientId, { projectId: 'p1', path, languageId, text });

function kinds(events: SessionEvent[], event: SessionEvent['event']): SessionEvent[] {
    return events.filter((candidate) => candidate.event === event);
}

describe('documents', () => {
    it('opens a document at version 1 and brings the server up for it', async () => {
        const { host, spawner } = await installed();
        const result = await open(host);
        expect(result).toEqual({ version: 1, servers: ['typescript'], providers: {} });
        await ready(host);
        expect(spawner.processes).toHaveLength(1);
        expect(spawner.processes[0].server.documents.get('file:///work/src/a.ts')?.text).toBe('let a = 1;\n');
    });

    it('answers what the document may ask once the server is up, and tells the clients when it comes up later', async () => {
        const { host, events } = await installed();
        await openReady(host);
        const [providers] = kinds(events['client-1'], 'language.providers');
        expect(providers).toMatchObject({ payload: { projectId: 'p1', path: 'src/a.ts' } });
        expect(Object.keys((providers as { payload: { providers: object } }).payload.providers)).toContain('textDocument/hover');
        const again = await open(host, 'src/a.ts', 'let a = 1;\n', 'client-2');
        expect(Object.keys(again.providers)).toContain('textDocument/hover');
    });

    it('raises the version by one per accepted change and keeps the server on the same text', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        const change = (baseVersion: number, text: string, character: number) => ({
            projectId: 'p1',
            path: 'src/a.ts',
            baseVersion,
            changes: [{ range: { start: { line: 0, character }, end: { line: 0, character } }, text }]
        });
        expect(await host.change(change(1, '2', 9))).toEqual({ version: 2 });
        expect(await host.change(change(2, '3', 10))).toEqual({ version: 3 });
        await settle();
        expect(spawner.processes[0].server.documents.get('file:///work/src/a.ts')).toEqual({ languageId: 'typescript', text: 'let a = 123;\n', version: 3 });
    });

    it('refuses a change against another base with a code the client knows, and changes nothing', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        const stale = host.change({ projectId: 'p1', path: 'src/a.ts', baseVersion: 4, changes: [{ text: 'x' }] });
        await expect(stale).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.staleDocument });
        const outside = host.change({
            projectId: 'p1',
            path: 'src/a.ts',
            baseVersion: 1,
            changes: [{ range: { start: { line: 9, character: 0 }, end: { line: 9, character: 0 } }, text: 'x' }]
        });
        await expect(outside).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.staleDocument });
        expect(spawner.processes[0].server.documents.get('file:///work/src/a.ts')).toEqual({ languageId: 'typescript', text: 'let a = 1;\n', version: 1 });
        expect(await open(host, 'src/a.ts', 'let a = 2;\n')).toMatchObject({ version: 2 });
    });

    it('shares one document between clients, replaces its text when another opens with different text, and keeps it until the last closes', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        expect((await open(host, 'src/a.ts', 'let a = 1;\n', 'client-2')).version).toBe(1);
        expect((await open(host, 'src/a.ts', 'let a = 9;\n', 'client-2')).version).toBe(2);
        await settle();
        expect(spawner.processes[0].server.documents.get('file:///work/src/a.ts')?.text).toBe('let a = 9;\n');
        await host.closeDocument('client-1', { projectId: 'p1', path: 'src/a.ts' });
        await settle();
        expect(spawner.processes[0].server.documents.has('file:///work/src/a.ts')).toBe(true);
        await host.closeDocument('client-2', { projectId: 'p1', path: 'src/a.ts' });
        await settle();
        expect(spawner.processes[0].server.exited).toBe(true);
        await expect(host.change({ projectId: 'p1', path: 'src/a.ts', baseVersion: 2, changes: [{ text: '' }] })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.documentNotOpen
        });
    });

    it('names a file the same whether the path is relative or absolute', async () => {
        const { host, spawner } = await installed();
        await openReady(host, 'src/a.ts');
        await open(host, '/work/src/../src/a.ts', 'let a = 1;\n', 'client-2');
        await settle();
        expect(spawner.processes[0].server.documents.size).toBe(1);
    });

    it('stops the server with its last document and starts a new one with the next', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        await open(host, 'src/b.ts');
        await settle();
        await host.closeDocument('client-1', { projectId: 'p1', path: 'src/a.ts' });
        await settle();
        expect(spawner.processes[0].server.exited).toBe(false);
        await host.closeDocument('client-1', { projectId: 'p1', path: 'src/b.ts' });
        await settle();
        expect(spawner.processes[0].server.exited).toBe(true);
        expect((await host.status('p1')).find((status) => status.server === 'typescript')?.state).toBe('stopped');
        await open(host, 'src/c.ts');
        await until(() => spawner.processes.length === 2);
        await ready(host);
    });

    it('closes the documents of a client whose socket went', async () => {
        const { host, spawner } = await installed();
        const unsubscribe = host.subscribe('client-3', () => undefined);
        await openReady(host, 'src/a.ts', 'let a = 1;\n', 'client-3');
        unsubscribe();
        await settle();
        expect(spawner.processes[0].server.exited).toBe(true);
    });

    it('holds a document of a language no server serves, so a client calls it the same way', async () => {
        const { host } = await installed();
        expect(await open(host, 'src/main.rs', 'fn main() {}', 'client-1', 'rust')).toEqual({ version: 1, servers: [], providers: {} });
        expect(await host.change({ projectId: 'p1', path: 'src/main.rs', baseVersion: 1, changes: [{ text: 'fn x() {}' }] })).toEqual({ version: 2 });
        await expect(host.request({ projectId: 'p1', path: 'src/main.rs', method: 'textDocument/hover', params: {} })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.unavailable
        });
    });
});

describe('access', () => {
    it('refuses what a file read would: the machine state under the home', async () => {
        const { host } = await installed();
        await expect(open(host, '/home/.ruimte/endpoint.json')).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.badPath });
    });

    it('allows a file outside the project folder by its absolute path', async () => {
        const { host } = await installed();
        expect(await open(host, '/elsewhere/lib/util.ts')).toMatchObject({ version: 1 });
    });

    it('refuses an unknown project', async () => {
        const { host } = await installed();
        await expect(host.open('client-1', { projectId: 'nope', path: 'a.ts', languageId: 'typescript', text: '' })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.projectNotFound
        });
    });
});

describe('requests', () => {
    it('answers a feature with the process and version, and refuses an older version', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        spawner.processes[0].server.handle('textDocument/hover', () => ({ contents: 'hover' }));
        const request = { projectId: 'p1', path: 'src/a.ts', method: 'textDocument/hover' as const, params: { position: { line: 0, character: 4 } } };
        expect(await host.request({ ...request, version: 1 })).toEqual({ result: { contents: 'hover' }, server: 'typescript', version: 1 });
        await host.change({ projectId: 'p1', path: 'src/a.ts', baseVersion: 1, changes: [{ text: 'let b;\n' }] });
        await expect(host.request({ ...request, version: 1 })).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.staleDocument });
        expect((await host.request(request)).version).toBe(2);
    });

    it('says why a request cannot be answered', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        const base = { projectId: 'p1', path: 'src/a.ts', params: {} };
        await expect(host.request({ ...base, method: 'textDocument/definition' })).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.unsupported });
        spawner.processes[0].server.handle('textDocument/hover', () => {
            throw new Error('server broke');
        });
        await expect(host.request({ ...base, method: 'textDocument/hover' })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.failed,
            message: 'server broke'
        });
        await spawner.processes[0].crash();
        await settle();
        await expect(host.request({ ...base, method: 'textDocument/hover' })).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.unavailable });
        await expect(host.request({ ...base, path: 'src/none.ts', method: 'textDocument/hover' })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.documentNotOpen
        });
    });
});

describe('events', () => {
    it('sends diagnostics to the clients that have the project open, and only those', async () => {
        const { host, spawner, events } = await installed();
        await openReady(host);
        const diagnostic = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, message: 'bad' };
        await spawner.processes[0].server.publishDiagnostics('file:///work/src/a.ts', [diagnostic], 1);
        await settle();
        expect(kinds(events['client-1'], 'language.diagnostics')).toEqual([
            { event: 'language.diagnostics', payload: { projectId: 'p1', path: 'src/a.ts', server: 'typescript', version: 1, diagnostics: [diagnostic] } }
        ]);
        expect(kinds(events['client-2'], 'language.diagnostics')).toEqual([]);
    });

    it('tells the project the state of its server as it changes', async () => {
        const { host, events } = await installed();
        await openReady(host);
        const states = kinds(events['client-1'], 'language.status').map((event) => (event as { payload: { status: { state: string } } }).payload.status.state);
        expect(states).toContain('starting');
        expect(states.at(-1)).toBe('ready');
    });
});

describe('the project going', () => {
    it('ends the servers and forgets the documents when the project closes', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        await host.end('p1');
        expect(spawner.processes[0].server.exited).toBe(true);
        await expect(host.change({ projectId: 'p1', path: 'src/a.ts', baseVersion: 1, changes: [{ text: '' }] })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.documentNotOpen
        });
        expect((await host.status('p1')).every((status) => status.state === 'stopped' || status.state === 'not-installed')).toBe(true);
    });

    it('stops everything when the daemon does', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        await host.close();
        expect(spawner.processes[0].server.exited).toBe(true);
    });
});

describe('install and status', () => {
    it('starts as not installed, installs only on a request and starts what waited', async () => {
        const { host, spawner, events, installs } = rig();
        expect((await host.status('p1')).map((status) => [status.server, status.state])).toEqual([
            ['typescript', 'not-installed'],
            ['vue', 'not-installed'],
            ['php', 'not-installed']
        ]);
        await open(host);
        await settle();
        expect(installs).toEqual([]);
        expect(spawner.processes).toHaveLength(0);
        expect((await host.status('p1'))[0]).toMatchObject({ state: 'not-installed', documents: 1 });

        expect(await host.install('typescript')).toMatchObject({ server: 'typescript', state: 'installing' });
        await ready(host);
        expect(spawner.processes).toHaveLength(1);
        expect(installs).toEqual(['typescript']);
        expect((await host.status('p1'))[0]).toMatchObject({ state: 'ready', version: '6.0.1', documents: 1 });
        const machine = kinds(events['client-2'], 'language.status').map(
            (event) => (event as { payload: { projectId: string | null; status: { state: string } } }).payload
        );
        expect(machine.map((payload) => [payload.projectId, payload.status.state])).toEqual([
            [null, 'installing'],
            [null, 'stopped']
        ]);
    });

    it('answers a failed install as not installed, with the reason', async () => {
        const failing = rig();
        const host = new LanguageHost({
            root,
            folderOf: () => '/work',
            holders: () => [],
            machineHome: { refuse: async () => undefined },
            run: async () => 1,
            spawn: failing.spawner.spawn
        });
        await host.install('php');
        await until(async () => (await host.status('p1'))[2].message !== undefined);
        expect((await host.status('p1'))[2]).toMatchObject({ server: 'php', state: 'not-installed', message: 'The installer exited with code 1' });
    });

    it('restarts a crashed server on request and says how it ended up', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        await spawner.processes[0].crash();
        await settle();
        expect((await host.status('p1'))[0]).toMatchObject({ state: 'crashed' });
        expect(await host.restart('p1', 'typescript')).toMatchObject({ state: 'ready' });
        expect(spawner.processes).toHaveLength(2);
        expect(spawner.processes[1].server.documents.has('file:///work/src/a.ts')).toBe(true);
    });

    it('serves the log of a kind: what the installer and the server wrote, in order', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        spawner.processes[0].say('server says hi');
        const lines = await host.log('p1', 'typescript');
        expect(lines.map((line) => [line.stream, line.text])).toContainEqual(['server', 'server says hi']);
        expect(lines[0].stream).toBe('install');
        expect(lines.map((line) => line.at)).toEqual([...lines.map((line) => line.at)].sort((a, b) => a - b));
    });
});
