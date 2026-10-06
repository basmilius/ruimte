import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { LANGUAGE_ERROR_CODES, type LanguageServerKind } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents/coded-error';
import { FakeWatch } from '@adecore/agents/watch-test-helpers';
import type { SessionEvent } from '../sessions/manager.ts';
import { LanguageChoices } from './choices.ts';
import { CustomLanguageServers } from './custom.ts';
import { LanguageHost } from './host.ts';
import { NativePolicy, type Download } from './native.ts';
import { KIND_PROFILES } from './profiles.ts';
import { FULL_CAPABILITIES, fakeSpawner, ManualClock, settle, type FakeProcess, type FakeSpawner } from './test-fakes.ts';
import { tarGz } from './test-archives.ts';
import { versionOf } from './versions.ts';

let root = '';

const STUBS_COMMIT = 'c'.repeat(40);

const stubsDownload: Download = async (_url, destination) => {
    await writeFile(destination, tarGz([{ path: `stubs/standard/a.php`, text: '<?php' }]));
};

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
    clock: ManualClock;
    /* The project's file watching, and the paths that exist on the fake disk. */
    watch: FakeWatch;
    disk: Set<string>;
}

/* The install of a kind is played by `run`, which leaves the scripts where bun would. */
function rig(
    options: {
        installed?: LanguageServerKind[];
        spawner?: FakeSpawner;
        packageJson?: string;
        files?: string[];
        platform?: NodeJS.Platform;
        choices?: LanguageChoices;
        native?: NativePolicy;
        /* The text of files that are no document, by path. */
        texts?: Record<string, string>;
    } = {}
): Rig {
    const spawner = options.spawner ?? fakeSpawner();
    const holders = new Set(['client-1']);
    const installs: LanguageServerKind[] = [];
    const clock = new ManualClock();
    const watch = new FakeWatch();
    const disk = new Set<string>();
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
        native: options.native ?? new NativePolicy({ checkout: { folder: join(root, 'repo'), version: '0.1.0', stubsCommit: STUBS_COMMIT } }),
        download: stubsDownload,
        run: async (spec, onLine) => {
            if (spec.command.endsWith('php-language-server')) {
                onLine('php-language-server 0.1.0');
                return 0;
            }
            if (spec.args[0] === 'build') {
                installs.push('php-native');
                await mkdir(join(spec.cwd, 'target', 'release'), { recursive: true });
                await writeFile(join(spec.cwd, 'target', 'release', 'php-language-server'), '');
                return 0;
            }
            if (spec.args.includes('--version')) {
                onLine(`Version ${versionOf('typescript')}`);
                return 0;
            }
            const kind = basename(spec.cwd) as LanguageServerKind;
            installs.push(kind);
            for (const component of KIND_PROFILES[kind].components) {
                const entry = join(spec.cwd, 'node_modules', component.entry);
                await mkdir(dirname(entry), { recursive: true });
                await writeFile(entry, '');
            }
            return 0;
        },
        clock,
        choices: options.choices ?? new LanguageChoices({ path: join(root, 'choices.json') }),
        watch: { platform: options.platform ?? 'darwin', seams: watch, stat: async (path) => (disk.has(path) ? 'file' : null) },
        custom: new CustomLanguageServers({
            path: join(root, 'custom.json'),
            resolve: (command) => (['zls', 'taplo'].includes(command) ? `/bin/${command}` : null)
        }),
        exists: async (path) => (options.files ?? []).includes(path),
        readText: async (path) => (path === '/work/package.json' ? (options.packageJson ?? null) : (options.texts?.[path] ?? null))
    });
    const events: Record<string, SessionEvent[]> = { 'client-1': [], 'client-2': [] };
    for (const clientId of Object.keys(events)) {
        host.subscribe(clientId, (event) => events[clientId].push(event));
    }
    return { host, spawner, holders, events, installs, clock, watch, disk };
}

async function installed(
    kinds: LanguageServerKind[] = ['typescript'],
    options: {
        packageJson?: string;
        files?: string[];
        spawner?: FakeSpawner;
        platform?: NodeJS.Platform;
        intelephense?: boolean;
        native?: NativePolicy;
        texts?: Record<string, string>;
    } = {}
): Promise<Rig> {
    // PHP goes to the server of Ruimte unless the machine picked Intelephense, which these tests stand in with.
    if (options.intelephense) {
        await writeFile(join(root, 'choices.json'), JSON.stringify({ picks: { php: 'php' } }));
    }
    const choices = new LanguageChoices({ path: join(root, 'choices.json') });
    await choices.load();
    const result = rig({ ...options, choices });
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

describe('a project that uses Vue', () => {
    const vuePackage = JSON.stringify({ dependencies: { vue: '^3.5.0' } });

    it('serves its scripts from the Vue kind, so one TypeScript server runs for the scripts and the components', async () => {
        const { host, spawner } = await installed(['typescript', 'vue'], { packageJson: vuePackage });
        const script = await open(host, 'src/main.ts', "import App from './App.vue';\n");
        expect(script.servers).toEqual(['vue']);
        await ready(host, 'vue');
        const component = await open(host, 'src/App.vue', '<template></template>\n', 'client-1', 'vue');
        expect(component.servers).toEqual(['vue']);
        await settle();
        expect(spawner.of('typescript')).toHaveLength(1);
        expect(spawner.of('vue')).toHaveLength(1);
        expect(spawner.of('typescript')[0].server.documents.has('file:///work/src/main.ts')).toBe(true);
    });

    it('leaves a project without Vue on the TypeScript kind', async () => {
        const { host } = await installed(['typescript', 'vue'], { packageJson: JSON.stringify({ dependencies: { react: '^19' } }) });
        expect((await open(host, 'src/main.ts')).servers).toEqual(['typescript']);
    });

    it('moves the scripts already open to the Vue kind when a .vue file shows the project uses it, and ends the TypeScript server', async () => {
        const { host, spawner } = await installed(['typescript', 'vue']);
        await openReady(host, 'src/main.ts');
        expect(spawner.of('typescript')).toHaveLength(1);
        await open(host, 'src/App.vue', '<template></template>\n', 'client-1', 'vue');
        await ready(host, 'vue');
        await settle();
        expect(spawner.of('typescript')[0].kills.length).toBeGreaterThan(0);
        // The Vue kind starts its own TypeScript server, which now holds the script.
        const live = spawner.of('typescript').at(-1)!;
        expect(live.server.documents.has('file:///work/src/main.ts')).toBe(true);
        expect((await host.status('p1')).find((status) => status.server === 'typescript')?.state).toBe('stopped');
    });
});

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
        expect(spawner.processes[0].server.documents.has('file:///work/src/a.ts')).toBe(false);
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

    it('keeps the server when its last document closes, so the next file finds it running', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        await host.closeDocument('client-1', { projectId: 'p1', path: 'src/a.ts' });
        await settle();
        expect(spawner.processes[0].server.exited).toBe(false);
        expect((await host.status('p1')).find((status) => status.server === 'typescript')?.state).toBe('ready');
        await open(host, 'src/c.ts');
        await settle();
        expect(spawner.processes).toHaveLength(1);
    });

    it('closes the documents of a client whose socket went, and keeps the server', async () => {
        const { host, spawner } = await installed();
        const unsubscribe = host.subscribe('client-3', () => undefined);
        await openReady(host, 'src/a.ts', 'let a = 1;\n', 'client-3');
        unsubscribe();
        await settle();
        expect(spawner.processes[0].server.exited).toBe(false);
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

describe('several servers on one document', () => {
    const eslintFiles = ['/work/eslint.config.js'];
    const caps = (extra: object = {}) => ({ textDocumentSync: 2 as const, hoverProvider: true, ...extra });

    it('adds ESLint to the kind of the language in a project that has an ESLint config, and nothing without one', async () => {
        const { host, spawner } = await installed(['typescript', 'eslint'], { files: eslintFiles });
        expect((await open(host)).servers).toEqual(['typescript', 'eslint']);
        await ready(host);
        await ready(host, 'eslint');
        expect(spawner.of('eslint')[0]!.server.documents.has('file:///work/src/a.ts')).toBe(true);
        expect(spawner.of('typescript')[0]!.server.documents.has('file:///work/src/a.ts')).toBe(true);
        expect(
            (await installed(['typescript', 'eslint'])).host.open('client-1', { projectId: 'p1', path: 'src/a.ts', languageId: 'typescript', text: '' })
        ).resolves.toMatchObject({
            servers: ['typescript']
        });
    });

    it('adds Tailwind where the package.json names it, to a stylesheet and to markup', async () => {
        const { host } = await installed(['css', 'tailwind', 'html'], { packageJson: JSON.stringify({ devDependencies: { tailwindcss: '^4' } }) });
        expect((await open(host, 'src/app.css', 'a {}', 'client-1', 'css')).servers).toEqual(['css', 'tailwind']);
        expect((await open(host, 'index.html', '<div></div>', 'client-1', 'html')).servers).toEqual(['html', 'tailwind']);
        expect((await open(host, 'main.py', '', 'client-1', 'python')).servers).toEqual(['python']);
    });

    it('lists an addition that is not installed as serving, and answers from the server that is', async () => {
        const spawner = fakeSpawner({ typescript: caps() });
        const { host } = await installed(['typescript'], { files: eslintFiles, spawner });
        await openReady(host);
        spawner.processes[0].server.handle('textDocument/hover', () => ({ contents: 'from tsserver' }));
        expect((await open(host)).servers).toEqual(['typescript', 'eslint']);
        const answer = await host.request({ projectId: 'p1', path: 'src/a.ts', method: 'textDocument/hover', params: {} });
        expect(answer).toMatchObject({ result: { contents: 'from tsserver' }, server: 'typescript' });
    });

    it('reports the diagnostics of each server under its own name, and clears both when the document closes', async () => {
        const { host, spawner, events } = await installed(['typescript', 'eslint'], { files: eslintFiles });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        const item = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'm' };
        await spawner
            .of('eslint')[0]!
            .server.connection.notify('textDocument/publishDiagnostics', { uri: 'file:///work/src/a.ts', version: 1, diagnostics: [item] });
        await settle();
        const reports = kinds(events['client-1'], 'language.diagnostics').map(
            (event) => (event as { payload: { server: string; diagnostics: unknown[] } }).payload
        );
        expect(reports.at(-1)).toMatchObject({ server: 'eslint', diagnostics: [item] });
        await host.closeDocument('client-1', { projectId: 'p1', path: 'src/a.ts' });
        const cleared = kinds(events['client-1'], 'language.diagnostics')
            .map((event) => (event as { payload: { server: string; diagnostics: unknown[] } }).payload)
            .filter((payload) => payload.diagnostics.length === 0)
            .map((payload) => payload.server);
        expect(cleared).toEqual(expect.arrayContaining(['typescript', 'eslint']));
    });

    it('merges the suggestions of both servers, and sends an item back to the server that made it', async () => {
        const spawner = fakeSpawner({
            typescript: caps({ completionProvider: { resolveProvider: true, triggerCharacters: ['.'] } }),
            eslint: caps({ completionProvider: { resolveProvider: true, triggerCharacters: ['"'] } })
        });
        const { host } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        spawner.of('typescript')[0]!.server.handle('textDocument/completion', () => [{ label: 'toFixed' }]);
        spawner.of('eslint')[0]!.server.handle('textDocument/completion', () => ({ isIncomplete: true, items: [{ label: 'rule' }] }));
        spawner.of('eslint')[0]!.server.handle('completionItem/resolve', (item) => ({ ...(item as object), detail: 'from eslint' }));
        const base = { projectId: 'p1', path: 'src/a.ts' };
        const answer = await host.request({ ...base, method: 'textDocument/completion', params: { position: { line: 0, character: 0 } } });
        expect(answer.result).toEqual({ isIncomplete: true, items: [{ label: 'toFixed' }, { label: 'rule' }] });
        expect(answer.itemServers).toEqual(['typescript', 'eslint']);
        const resolved = await host.request({ ...base, method: 'completionItem/resolve', params: { label: 'rule' }, server: 'eslint' });
        expect(resolved).toMatchObject({ result: { detail: 'from eslint' }, server: 'eslint' });
        const opened = await open(host);
        expect(opened.providers['textDocument/completion']).toEqual({ resolveProvider: true, triggerCharacters: ['.', '"'] });
    });

    it('names the process of every code action across the native server, its sidecar and ESLint, and sends a resolve back to the sidecar', async () => {
        const spawner = fakeSpawner(
            {
                typescript: caps({ codeActionProvider: {} }),
                'typescript-actions': caps({ codeActionProvider: { resolveProvider: true } }),
                eslint: caps({ codeActionProvider: {} })
            },
            [],
            {
                typescript: { 'textDocument/codeAction': () => [{ title: 'Add import', kind: 'quickfix' }] },
                'typescript-actions': {
                    'textDocument/codeAction': () => [{ title: 'Extract function', kind: 'refactor.extract' }],
                    'codeAction/resolve': (item) => ({ ...(item as object), edit: { changes: {} } })
                },
                eslint: { 'textDocument/codeAction': () => [{ title: 'Fix semi', kind: 'quickfix' }] }
            }
        );
        const { host } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        const base = { projectId: 'p1', path: 'src/a.ts' };
        const answer = await host.request({
            ...base,
            method: 'textDocument/codeAction',
            params: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, context: { diagnostics: [] } }
        });
        expect(answer.result).toEqual([
            { title: 'Add import', kind: 'quickfix' },
            { title: 'Extract function', kind: 'refactor.extract' },
            { title: 'Fix semi', kind: 'quickfix' }
        ]);
        expect(answer.itemServers).toEqual(['typescript', 'typescript-actions', 'eslint']);
        const resolved = await host.request({ ...base, method: 'codeAction/resolve', params: { title: 'Extract function' }, server: 'typescript-actions' });
        expect(resolved).toMatchObject({ server: 'typescript-actions', result: { edit: { changes: {} } } });
        const statuses = await host.status('p1');
        expect(statuses.find((status) => status.server === 'typescript')?.sidecars).toEqual([
            { name: 'typescript-actions', title: 'TypeScript 6', state: 'ready' }
        ]);
    });

    it('leaves out a server that has not answered a merged call when the deadline passes, and drops its late answer', async () => {
        const spawner = fakeSpawner({
            typescript: caps({ completionProvider: { triggerCharacters: ['.'] } }),
            eslint: caps({ completionProvider: { triggerCharacters: ['"'] } })
        });
        const { host, clock } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        let answerLate: (items: unknown[]) => void = () => undefined;
        spawner.of('typescript')[0]!.server.handle('textDocument/completion', () => [{ label: 'toFixed' }]);
        spawner.of('eslint')[0]!.server.handle(
            'textDocument/completion',
            () =>
                new Promise((resolve) => {
                    answerLate = resolve;
                })
        );
        const asked = host.request({ projectId: 'p1', path: 'src/a.ts', method: 'textDocument/completion', params: { position: { line: 0, character: 0 } } });
        await settle();
        clock.fire();
        const answer = await asked;
        expect(answer.result).toEqual({ isIncomplete: false, items: [{ label: 'toFixed' }] });
        expect(answer.itemServers).toEqual(['typescript']);
        answerLate([{ label: 'late' }]);
        await settle();
        expect((await host.log('p1', 'eslint')).some((line) => line.text.includes('Left out of a textDocument/completion'))).toBe(true);
    });

    it('waits for the first server without a deadline, so a slow server of the language still answers', async () => {
        const spawner = fakeSpawner({
            typescript: caps({ hoverProvider: true }),
            eslint: caps({ hoverProvider: true })
        });
        const { host, clock } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        let answerSlowly: (hover: unknown) => void = () => undefined;
        spawner.of('typescript')[0]!.server.handle(
            'textDocument/hover',
            () =>
                new Promise((resolve) => {
                    answerSlowly = resolve;
                })
        );
        spawner.of('eslint')[0]!.server.handle('textDocument/hover', () => ({ contents: { kind: 'markdown', value: 'rule docs' } }));
        const asked = host.request({ projectId: 'p1', path: 'src/a.ts', method: 'textDocument/hover', params: {} });
        await settle();
        clock.fire();
        await settle();
        answerSlowly({ contents: { kind: 'markdown', value: 'types' } });
        expect((await asked).result).toEqual({ contents: ['types', 'rule docs'] });
    });

    it('keeps the answer of the server that answers when the other fails, and gives a feature that does not add up to the first', async () => {
        const spawner = fakeSpawner({ typescript: caps({ definitionProvider: true }), eslint: caps({ definitionProvider: true }) });
        const { host } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        spawner.of('typescript')[0]!.server.handle('textDocument/hover', () => {
            throw new Error('broke');
        });
        spawner.of('eslint')[0]!.server.handle('textDocument/hover', () => ({ contents: { kind: 'markdown', value: 'rule docs' } }));
        spawner.of('typescript')[0]!.server.handle('textDocument/definition', () => ({ uri: 'file:///a', range: {} }));
        spawner.of('eslint')[0]!.server.handle('textDocument/definition', () => ({ uri: 'file:///b', range: {} }));
        const base = { projectId: 'p1', path: 'src/a.ts', params: {} };
        expect((await host.request({ ...base, method: 'textDocument/hover' })).result).toEqual({ contents: ['rule docs'] });
        expect((await host.request({ ...base, method: 'textDocument/definition' })).result).toEqual({ uri: 'file:///a', range: {} });
    });
});

describe('language servers of a person', () => {
    const zig = {
        name: 'Zig',
        command: 'zls',
        args: ['--stdio'],
        env: { ZLS_LOG: '1' },
        languages: ['zig'],
        patterns: [],
        initializationOptions: { snippets: true }
    };

    it('starts on the first document it serves, as the command it was saved with, and reports under its id', async () => {
        const { host, spawner, events } = rig();
        const saved = await host.customSave(zig);
        const opened = await open(host, 'src/main.zig', 'const a = 1;', 'client-1', 'zig');
        expect(opened.servers).toEqual([saved.id]);
        await ready(host, saved.id);
        const [process] = spawner.of('zls');
        expect(process!.spec).toMatchObject({ command: 'zls', args: ['--stdio'], cwd: '/work', env: { ZLS_LOG: '1' } });
        expect(process!.spec.env.BUN_BE_BUN).toBeUndefined();
        expect(process!.server.received.find((message) => message.method === 'initialize')?.params).toMatchObject({
            initializationOptions: { snippets: true }
        });
        process!.server.handle('textDocument/hover', () => ({ contents: 'zig hover' }));
        expect(await host.request({ projectId: 'p1', path: 'src/main.zig', method: 'textDocument/hover', params: {} })).toMatchObject({
            result: { contents: 'zig hover' },
            server: saved.id
        });
        await process!.server.connection.notify('textDocument/publishDiagnostics', { uri: 'file:///work/src/main.zig', version: 1, diagnostics: [] });
        await settle();
        expect(kinds(events['client-1'], 'language.diagnostics').at(-1)).toMatchObject({ payload: { server: saved.id } });
    });

    it('serves by file pattern, and only the projects it was saved for', async () => {
        const { host } = rig();
        const byPattern = await host.customSave({ name: 'Templates', command: 'taplo', args: [], languages: [], patterns: ['*.tpl'] });
        await host.customSave({ ...zig, projects: ['/elsewhere'] });
        expect((await open(host, 'views/a.tpl', '', 'client-1', 'plaintext')).servers).toEqual([byPattern.id]);
        expect((await open(host, 'src/main.zig', '', 'client-1', 'zig')).servers).toEqual([]);
        const statuses = await host.status('p1');
        expect(statuses.filter((status) => status.server.startsWith('custom:')).map((status) => status.name)).toEqual(['Templates']);
    });

    it('starts for the file that is open when it is saved, and stops when it is removed', async () => {
        const { host, spawner, events } = rig();
        expect((await open(host, 'src/main.zig', '', 'client-1', 'zig')).servers).toEqual([]);
        const saved = await host.customSave(zig);
        await ready(host, saved.id);
        expect(spawner.of('zls')[0]!.server.documents.has('file:///work/src/main.zig')).toBe(true);
        expect(kinds(events['client-2'], 'language.custom.changed')).toHaveLength(1);
        await host.customRemove(saved.id);
        expect(spawner.of('zls')[0]!.server.exited).toBe(true);
        expect((await host.status('p1')).some((status) => status.server === saved.id)).toBe(false);
        expect(kinds(events['client-1'], 'language.providers').at(-1)).toMatchObject({ payload: { path: 'src/main.zig', providers: {} } });
    });

    it('starts again with what was saved when a server is changed', async () => {
        const { host, spawner } = rig();
        const saved = await host.customSave(zig);
        await open(host, 'src/main.zig', '', 'client-1', 'zig');
        await ready(host, saved.id);
        await host.customSave({ ...zig, id: saved.id, args: ['--other'] });
        await until(() => spawner.of('zls').length === 2);
        expect(spawner.of('zls')[0]!.server.exited).toBe(true);
        expect(spawner.of('zls')[1]!.spec.args).toEqual(['--other']);
    });

    it('never starts a server whose command was changed in the file, and says so', async () => {
        const { host, spawner } = rig();
        const saved = await host.customSave(zig);
        const file = JSON.parse(await readFile(join(root, 'custom.json'), 'utf8')) as { servers: { command: string }[] };
        file.servers[0]!.command = 'taplo';
        await writeFile(join(root, 'custom.json'), JSON.stringify(file));
        const second = new CustomLanguageServers({ path: join(root, 'custom.json'), resolve: (command) => `/bin/${command}` });
        await second.load();
        const held = new LanguageHost({
            root,
            folderOf: () => '/work',
            holders: () => [],
            machineHome: { refuse: async () => undefined },
            spawn: spawner.spawn,
            custom: second
        });
        expect((await held.open('client-1', { projectId: 'p1', path: 'a.zig', languageId: 'zig', text: '' })).servers).toEqual([]);
        expect((await held.status('p1')).find((status) => status.server === saved.id)).toMatchObject({ state: 'crashed' });
        expect(spawner.processes).toHaveLength(0);
    });

    it('stays crashed when the process ends, and starts again only on a restart', async () => {
        const { host, spawner } = rig();
        const saved = await host.customSave(zig);
        await open(host, 'src/main.zig', '', 'client-1', 'zig');
        await ready(host, saved.id);
        await spawner.of('zls')[0]!.crash(2);
        await settle();
        expect((await host.status('p1')).find((status) => status.server === saved.id)).toMatchObject({
            state: 'crashed',
            message: expect.stringContaining('Zig')
        });
        await host.restart('p1', saved.id);
        await ready(host, saved.id);
        expect(spawner.of('zls')).toHaveLength(2);
    });
});

describe('commands', () => {
    const edit = { changes: { 'file:///work/src/a.ts': [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'const' }] } };

    async function commandRig() {
        const result = await installed();
        await openReady(result.host);
        const { server } = result.spawner.processes[0];
        return { ...result, server };
    }

    it('runs a command on the server and hands the result back', async () => {
        const { host, server } = await commandRig();
        server.handle('workspace/executeCommand', (params) => ({ ran: (params as { command: string }).command }));
        expect(await host.command('client-1', { projectId: 'p1', path: 'src/a.ts', command: 'fix.all', arguments: [1] })).toEqual({
            result: { ran: 'fix.all' },
            server: 'typescript'
        });
        expect(server.paramsOf('workspace/executeCommand')).toEqual([{ command: 'fix.all', arguments: [1] }]);
    });

    it('forwards an edit the server asks for during a command to that client only, and answers the server with what the client said', async () => {
        const { host, server, events } = await commandRig();
        server.handle('workspace/executeCommand', async () => ({ applied: await server.request('workspace/applyEdit', { label: 'Fix', edit }) }));
        const running = host.command('client-1', { projectId: 'p1', path: 'src/a.ts', command: 'fix.all' });
        await settle();
        const [asked] = kinds(events['client-1'], 'language.edit');
        expect(asked).toMatchObject({ payload: { projectId: 'p1', label: 'Fix', edit } });
        expect(kinds(events['client-2'], 'language.edit')).toHaveLength(0);
        const { editId } = (asked as { payload: { editId: string } }).payload;
        host.answerEdit('client-2', { projectId: 'p1', editId, applied: true });
        host.answerEdit('client-1', { projectId: 'p1', editId, applied: false, failureReason: 'Not open' });
        expect((await running).result).toEqual({ applied: { applied: false, failureReason: 'Not open' } });
    });

    it('refuses an edit while no command runs, and one the client leaves unanswered', async () => {
        const { host, server, clock, events } = await commandRig();
        expect(await server.request('workspace/applyEdit', { edit })).toMatchObject({ applied: false });
        expect(kinds(events['client-1'], 'language.edit')).toHaveLength(0);
        server.handle('workspace/executeCommand', async () => server.request('workspace/applyEdit', { edit }));
        const running = host.command('client-1', { projectId: 'p1', path: 'src/a.ts', command: 'fix.all' });
        await settle();
        clock.fire();
        expect((await running).result).toEqual({ applied: false, failureReason: 'The client did not answer' });
    });

    it('stops waiting for a client that went away', async () => {
        const { host, server } = await commandRig();
        const leave = host.subscribe('client-3', () => undefined);
        server.handle('workspace/executeCommand', async () => server.request('workspace/applyEdit', { edit }));
        const running = host.command('client-3', { projectId: 'p1', path: 'src/a.ts', command: 'fix.all' });
        await settle();
        leave();
        expect((await running).result).toMatchObject({ applied: false });
    });
});

describe('events', () => {
    it('tells the clients a file has no problems once its last document closes', async () => {
        const { host, events } = await installed();
        await openReady(host);
        events['client-1'].length = 0;
        await host.closeDocument('client-1', { projectId: 'p1', path: 'src/a.ts' });
        expect(kinds(events['client-1'], 'language.diagnostics')).toEqual([
            { event: 'language.diagnostics', payload: { projectId: 'p1', path: 'src/a.ts', server: 'typescript', diagnostics: [] } }
        ]);
    });

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
        expect((await host.status('p1')).map((status) => [status.server, status.state])).toEqual(
            Object.keys(KIND_PROFILES).map((kind) => [kind, 'not-installed'])
        );
        await open(host);
        await settle();
        expect(installs).toEqual([]);
        expect(spawner.processes).toHaveLength(0);
        expect((await host.status('p1'))[0]).toMatchObject({ state: 'not-installed', documents: 1 });

        expect(await host.install('typescript')).toMatchObject({ server: 'typescript', state: 'installing' });
        await ready(host);
        expect(spawner.processes).toHaveLength(1);
        expect(installs).toEqual(['typescript']);
        expect((await host.status('p1'))[0]).toMatchObject({ state: 'ready', version: '7.0.2', documents: 1 });
        const machine = kinds(events['client-2'], 'language.status').map(
            (event) => (event as { payload: { projectId: string | null; status: { state: string } } }).payload
        );
        expect(machine.map((payload) => [payload.projectId, payload.status.state])).toEqual([
            [null, 'installing'],
            [null, 'stopped']
        ]);
    });

    it('answers an install of older versions as not installed and says an install updates it', async () => {
        const { host } = await installed(['typescript']);
        await writeFile(
            join(root, 'typescript', 'installed.json'),
            JSON.stringify({ versions: { 'typescript-language-server': '6.0.1', typescript: '6.0.3' } })
        );
        expect((await host.status('p1'))[0]).toMatchObject({ state: 'not-installed', message: expect.stringContaining('Install it again to update') });
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
        const php = async () => (await host.status('p1')).find((status) => status.server === 'php')!;
        await until(async () => (await php()).message !== undefined);
        expect(await php()).toMatchObject({ server: 'php', state: 'not-installed', message: 'The installer exited with code 1' });
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

/* What a server does when it asks to hear about files: a `client/registerCapability` for `workspace/didChangeWatchedFiles`. */
async function registerWatchers(process: FakeProcess, id: string, globs: { globPattern: string; kind?: number }[]): Promise<void> {
    await process.server.request('client/registerCapability', {
        registrations: [{ id, method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: globs } }]
    });
    await settle();
}

describe('files that change on disk', () => {
    it('reaches a PHP server for a file created beside the one that is open', async () => {
        const { host, spawner, watch, disk } = await installed(['php'], { intelephense: true });
        await open(host, 'main.php', '<?php\nnew Gener;\n', 'client-1', 'php');
        await ready(host, 'php');
        const [php] = spawner.of('php');
        expect(watch.watchers).toHaveLength(0);

        await registerWatchers(php, 'php-files', [{ globPattern: '**/*.{php,phtml}' }]);
        expect(watch.openOn('/work')).toHaveLength(1);

        disk.add('/work/Generated.php');
        watch.on('/work').emit('Generated.php', 'rename');
        watch.on('/work').emit('notes.txt', 'rename');
        expect(watch.pending).toBe(1);
        await watch.settle();
        expect(php.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: 'file:///work/Generated.php', type: 1 }] }]);
    });

    it('hands the PHP server of Ruimte the files of other languages its patterns name, without looking at their language', async () => {
        const { host, spawner, watch, disk } = await installed(['php-native']);
        await open(host, 'src/a.php', '<?php', 'client-1', 'php');
        await ready(host, 'php-native');
        const [php] = spawner.of('php-native');
        // What the server registers in its release 0.2.0.
        const globs = [
            '**/*.php',
            '**/composer.json',
            '**/vendor/composer/installed.json',
            '**/.env',
            '**/.env.*',
            '**/lang/**',
            '**/translations/**',
            '**/templates/**',
            '**/config/**/*.yaml',
            '**/config/**/*.yml',
            '**/config/**/*.xml',
            '**/database/schema/*.sql',
            '**/resources/{js,ts}/{Pages,pages}/**'
        ];
        await registerWatchers(
            php!,
            'php-files',
            globs.map((globPattern) => ({ globPattern }))
        );

        const changed = [
            'resources/js/Pages/Users/Index.vue',
            'resources/ts/pages/Home.tsx',
            'resources/js/Pages/Settings.svelte',
            'templates/base.html.twig',
            'config/packages/doctrine.yaml',
            'vendor/composer/installed.json'
        ];
        for (const path of changed) {
            disk.add(`/work/${path}`);
            watch.on('/work').emit(path, 'change');
        }
        watch.on('/work').emit('resources/js/Components/Button.vue', 'change');
        watch.on('/work').emit('vendor/laravel/framework/src/Foundation/Application.php', 'change');
        await watch.settle();
        const [{ changes }] = php!.server.paramsOf('workspace/didChangeWatchedFiles') as [{ changes: { uri: string }[] }];
        expect(changes.map((change) => change.uri).sort()).toEqual(changed.map((path) => `file:///work/${path}`).sort());
    });

    it('tells a server that a file changed or went, in one batch per burst', async () => {
        const { host, spawner, watch, disk } = await installed(['php'], { intelephense: true });
        await open(host, 'main.php', '<?php', 'client-1', 'php');
        await ready(host, 'php');
        const [php] = spawner.of('php');
        await registerWatchers(php, 'php-files', [{ globPattern: '**/*.php' }]);

        disk.add('/work/src/Kept.php');
        watch.on('/work').emit('src/Kept.php', 'change');
        watch.on('/work').emit('src/Gone.php', 'rename');
        watch.on('/work').emit('src/Kept.php', 'change');
        await watch.settle();
        expect(php.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([
            {
                changes: [
                    { uri: 'file:///work/src/Gone.php', type: 3 },
                    { uri: 'file:///work/src/Kept.php', type: 2 }
                ]
            }
        ]);
    });

    it('leaves dependency folders alone unless a server named them, and skips a directory that appeared', async () => {
        const { host, spawner, watch } = await installed(['php'], { intelephense: true });
        await open(host, 'main.php', '<?php', 'client-1', 'php');
        await ready(host, 'php');
        const [php] = spawner.of('php');
        await registerWatchers(php, 'php-files', [{ globPattern: '**/*.php' }]);

        watch.on('/work').emit('vendor/acme/Thing.php', 'change');
        watch.on('/work').emit('node_modules/x/Thing.php', 'change');
        expect(watch.pending).toBe(0);

        await registerWatchers(php, 'vendor-files', [{ globPattern: 'vendor/composer/installed.json' }]);
        watch.on('/work').emit('vendor/composer/installed.json', 'change');
        expect(watch.pending).toBe(1);
    });

    it('sends the change of an ESLint or Tailwind config only to the server that registered for it', async () => {
        const { host, spawner, watch, disk } = await installed(['typescript', 'eslint', 'tailwind'], {
            files: ['/work/eslint.config.js', '/work/tailwind.config.js']
        });
        await open(host, 'src/a.ts', 'let a = 1;\n');
        await until(async () => spawner.of('eslint').length > 0 && spawner.of('tailwind').length > 0 && spawner.of('typescript').length > 0);
        await settle();
        const [eslint] = spawner.of('eslint');
        const [tailwind] = spawner.of('tailwind');
        const [typescript] = spawner.of('typescript');
        await registerWatchers(eslint, 'eslint-config', [{ globPattern: '**/eslint.config.*' }, { globPattern: '**/package.json' }]);
        await registerWatchers(tailwind, 'tailwind-config', [{ globPattern: '**/tailwind.config.{js,cjs,mjs,ts}' }]);

        disk.add('/work/eslint.config.js');
        disk.add('/work/tailwind.config.js');
        watch.on('/work').emit('eslint.config.js', 'change');
        watch.on('/work').emit('tailwind.config.js', 'change');
        await watch.settle();
        expect(eslint.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: 'file:///work/eslint.config.js', type: 2 }] }]);
        expect(tailwind.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: 'file:///work/tailwind.config.js', type: 2 }] }]);
        expect(typescript.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([]);
    });

    it('stops watching when no server asks any more, and when the project closes', async () => {
        const { host, spawner, watch } = await installed(['php'], { intelephense: true });
        await open(host, 'main.php', '<?php', 'client-1', 'php');
        await ready(host, 'php');
        const [php] = spawner.of('php');
        await registerWatchers(php, 'php-files', [{ globPattern: '**/*.php' }]);
        expect(watch.openOn('/work')).toHaveLength(1);

        await php.server.request('client/unregisterCapability', { unregisterations: [{ id: 'php-files', method: 'workspace/didChangeWatchedFiles' }] });
        await settle();
        expect(watch.openOn('/work')).toHaveLength(0);

        await registerWatchers(php, 'php-again', [{ globPattern: '**/*.php' }]);
        expect(watch.openOn('/work')).toHaveLength(1);
        await host.end('p1');
        expect(watch.openOn('/work')).toHaveLength(0);
    });

    it('watches the directories of the open documents where a tree cannot be watched in one call', async () => {
        const { host, spawner, watch, disk } = await installed(['php'], { platform: 'linux', intelephense: true });
        await open(host, 'src/Models/User.php', '<?php', 'client-1', 'php');
        await ready(host, 'php');
        const [php] = spawner.of('php');
        await registerWatchers(php, 'php-files', [{ globPattern: '**/*.php' }]);
        expect(watch.openOn('/work')[0]?.recursive).toBe(false);
        await open(host, 'src/Http/Controller.php', '<?php', 'client-1', 'php');
        expect(watch.openOn('/work/src/Models')).toHaveLength(1);
        expect(watch.openOn('/work/src/Http')).toHaveLength(1);

        disk.add('/work/src/Models/Post.php');
        watch.on('/work/src/Models').emit('Post.php', 'rename');
        await watch.settle();
        expect(php.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: 'file:///work/src/Models/Post.php', type: 1 }] }]);
    });
});

describe('the PHP server of Ruimte and Intelephense', () => {
    const picked = async (kind: 'php' | 'php-native') => {
        await writeFile(join(root, 'choices.json'), JSON.stringify({ picks: { php: kind } }));
    };

    it('serves PHP with the server of Ruimte by default and lists Intelephense as the alternative', async () => {
        const { host } = await installed(['php-native', 'php']);
        const statuses = await host.status('p1');
        expect(statuses.find((status) => status.server === 'php-native')).toMatchObject({ version: '0.1.0', chosen: true });
        expect(statuses.find((status) => status.server === 'php')).toMatchObject({ chosen: false });
        expect(statuses.find((status) => status.server === 'css')?.chosen).toBeUndefined();
        expect((await open(host, 'src/a.php', '<?php', 'client-1', 'php')).servers).toEqual(['php-native']);
    });

    it('runs the program of the kind with the storage and the stubs it installed, and the pull of diagnostics', async () => {
        const { host, spawner } = await installed(['php-native']);
        await open(host, 'src/a.php', '<?php', 'client-1', 'php');
        await ready(host, 'php-native');
        const [process] = spawner.of('php-native');
        const install = join(root, 'php-native');
        expect(process!.spec.command).toBe(join(root, 'repo', 'target', 'release', 'php-language-server'));
        expect(process!.spec.args).toEqual(['--stdio']);
        expect(process!.server.paramsOf('initialize')[0]).toMatchObject({
            initializationOptions: { storagePath: join(install, 'storage'), stubsPath: join(install, 'storage', 'stubs', STUBS_COMMIT) }
        });
    });

    it('serves a template of PHP by its name when the editor gave it no language', async () => {
        const { host } = await installed(['php-native']);
        expect((await open(host, 'views/page.phtml', '<p>', 'client-1', 'plaintext')).servers).toEqual(['php-native']);
    });

    it('serves Twig, Blade and the configuration of a Symfony project with the server of Ruimte', async () => {
        const { host } = await installed(['php-native', 'yaml'], { files: ['/work/composer.json'] });
        expect((await open(host, 'templates/base.html.twig', '{{ title }}', 'client-1', 'twig')).servers).toEqual(['php-native']);
        expect((await open(host, 'resources/views/welcome.blade.php', '@if(true)', 'client-1', 'php')).servers).toEqual(['php-native']);
        expect((await open(host, 'config/services.yaml', 'services:', 'client-1', 'yaml')).servers).toEqual(['yaml', 'php-native']);
        expect((await open(host, 'translations/messages.en.yml', 'hello: Hello', 'client-1', 'yaml')).servers).toEqual(['yaml', 'php-native']);
        expect((await open(host, '.github/workflows/ci.yml', 'on: push', 'client-1', 'yaml')).servers).toEqual(['yaml']);
    });

    it('leaves the YAML of a project without composer.json to the YAML server', async () => {
        const { host } = await installed(['php-native', 'yaml']);
        expect((await open(host, 'config/services.yaml', 'services:', 'client-1', 'yaml')).servers).toEqual(['yaml']);
    });

    it('moves the open documents to the other server, clears what the first reported and ends it', async () => {
        const { host, spawner, events } = await installed(['php-native', 'php']);
        await open(host, 'src/a.php', '<?php', 'client-1', 'php');
        await ready(host, 'php-native');
        const [first] = spawner.of('php-native');
        events['client-1'].length = 0;
        const status = await host.prefer('php');
        expect(status).toMatchObject({ server: 'php', chosen: true });
        await ready(host, 'php');
        await settle();
        expect(first!.kills).toEqual(['SIGTERM']);
        expect((await host.status('p1')).find((entry) => entry.server === 'php-native')).toMatchObject({ state: 'stopped', chosen: false });
        expect((await open(host, 'src/a.php', '<?php', 'client-1', 'php')).servers).toEqual(['php']);
        expect(kinds(events['client-1'], 'language.diagnostics').map((event) => (event as { payload: { server: string } }).payload.server)).toContain(
            'php-native'
        );
        const changed = kinds(events['client-1'], 'language.status').map(
            (event) => (event as { payload: { projectId: string | null; status: { server: string; chosen?: boolean } } }).payload
        );
        expect(changed).toEqual(
            expect.arrayContaining([
                { projectId: null, status: expect.objectContaining({ server: 'php', chosen: true }) },
                { projectId: null, status: expect.objectContaining({ server: 'php-native', chosen: false }) }
            ])
        );
        expect(JSON.parse(await readFile(join(root, 'choices.json'), 'utf8'))).toEqual({ picks: { php: 'php' } });
    });

    it('keeps the choice across a restart of the daemon', async () => {
        await picked('php');
        const { host } = await installed(['php-native', 'php'], { intelephense: true });
        expect((await host.status('p1')).find((status) => status.server === 'php')).toMatchObject({ chosen: true });
        expect((await open(host, 'src/a.php', '<?php', 'client-1', 'php')).servers).toEqual(['php']);
    });

    it('refuses to choose a kind that has no alternative', async () => {
        const { host } = await installed(['typescript']);
        await expect(host.prefer('typescript')).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.invalidServer });
    });

    it('says a build with nothing to install is unavailable, and starts no install for it', async () => {
        const { host, installs } = await installed(['typescript'], { native: new NativePolicy({ checkout: null, releases: {} }) });
        expect((await host.status('p1')).find((status) => status.server === 'php-native')).toMatchObject({
            state: 'not-installed',
            version: '',
            unavailable: true
        });
        await host.install('php-native');
        await until(async () => (await host.status('p1')).find((status) => status.server === 'php-native')?.message !== undefined);
        expect((await host.status('p1')).find((status) => status.server === 'php-native')).toMatchObject({ message: 'Not available in this build yet' });
        expect(installs).toEqual(['typescript']);
    });
});

describe('files that move', () => {
    const filters = [{ scheme: 'file', pattern: { glob: '**/*.ts', matches: 'file' as const } }];
    const capabilities = { typescript: { ...FULL_CAPABILITIES, workspace: { fileOperations: { willRename: { filters }, didRename: { filters } } } } };
    const aToC = { from: '/work/src/a.ts', to: '/work/src/c.ts' };
    const line = (path: string, text: string) => ({
        textDocument: { uri: `file://${path}`, version: null },
        edits: [{ range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } }, newText: text }]
    });

    async function moveRig(answer?: (params: unknown) => unknown) {
        const spawner = fakeSpawner(capabilities, [], answer === undefined ? {} : { typescript: { 'workspace/willRenameFiles': answer } });
        const result = await installed(['typescript'], { spawner, texts: { '/work/src/b.ts': 'import "./a";\n' } });
        await openReady(result.host, 'src/a.ts', 'export "./a";\n');
        const calls: string[] = [];
        const written: Array<{ path: string; text: string }> = [];
        const file = {
            move: async () => void calls.push('move'),
            write: async (path: string, text: string) => {
                calls.push('write');
                written.push({ path, text });
            }
        };
        const server = spawner.processes[0].server;
        return { ...result, server, calls, written, file };
    }

    const importEdits = () => ({ documentChanges: [line('/work/src/a.ts', './c'), line('/work/src/b.ts', './c')] });

    it('makes what a server would change before the move, in the open editor and in the file nobody has open, and tells it afterwards', async () => {
        const { host, server, calls, written, file, events } = await moveRig(importEdits);
        const moving = host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file);
        await until(() => kinds(events['client-1'], 'language.edit').length > 0);
        const [asked] = kinds(events['client-1'], 'language.edit');
        const { editId, edit } = (asked as { payload: { editId: string; edit: { documentChanges: Array<{ textDocument: { uri: string } }> } } }).payload;
        expect(edit.documentChanges.map((change) => change.textDocument.uri)).toEqual(['file:///work/src/a.ts']);
        expect(calls).toEqual([]);
        host.answerEdit('client-1', { projectId: 'p1', editId, applied: true });
        expect(await moving).toEqual(['/work/src/a.ts', '/work/src/b.ts']);
        expect(calls).toEqual(['write', 'move']);
        expect(written).toEqual([{ path: '/work/src/b.ts', text: 'import "./c";\n' }]);
        expect(server.paramsOf('workspace/willRenameFiles')).toEqual([{ files: [{ oldUri: 'file:///work/src/a.ts', newUri: 'file:///work/src/c.ts' }] }]);
        expect(server.paramsOf('workspace/didRenameFiles')).toEqual([{ files: [{ oldUri: 'file:///work/src/a.ts', newUri: 'file:///work/src/c.ts' }] }]);
    });

    it('sends the edit of an open document to the client that asked, and only the files it holds', async () => {
        const { host, calls, file, events } = await moveRig(importEdits);
        await open(host, 'src/a.ts', 'export "./a";\n', 'client-2');
        const unsubscribe = host.subscribe('client-2', (event) => {
            events['client-2'].push(event);
            if (event.event === 'language.edit') {
                host.answerEdit('client-2', { projectId: 'p1', editId: (event as { payload: { editId: string } }).payload.editId, applied: true });
            }
        });
        try {
            await host.renameFiles('client-2', 'p1', aToC.from, aToC.to, true, file);
        } finally {
            unsubscribe();
        }
        expect(kinds(events['client-1'], 'language.edit')).toHaveLength(0);
        expect(kinds(events['client-2'], 'language.edit')).toHaveLength(1);
        expect(calls).toEqual(['write', 'move']);
    });

    it('moves anyway when a server is slow, and leaves its late answer out', async () => {
        const { host, calls, file, clock, server } = await moveRig(() => new Promise(() => undefined));
        const moving = host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file);
        await until(() => server.paramsOf('workspace/willRenameFiles').length > 0);
        clock.fire();
        expect(await moving).toEqual([]);
        expect(calls).toEqual(['move']);
        expect(server.paramsOf('workspace/didRenameFiles')).toHaveLength(1);
        expect((await host.log('p1', 'typescript')).map((entry) => entry.text).join('\n')).toContain('did not answer workspace/willRenameFiles');
    });

    it('moves anyway when a server fails', async () => {
        const { host, calls, file } = await moveRig(() => {
            throw new Error('boom');
        });
        expect(await host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file)).toEqual([]);
        expect(calls).toEqual(['move']);
    });

    it('asks nothing when the caller made the edits itself, and nothing of a file no filter takes', async () => {
        const { host, calls, file, server } = await moveRig(importEdits);
        await host.renameFiles('client-1', 'p1', aToC.from, aToC.to, false, file);
        await host.renameFiles('client-1', 'p1', '/work/notes.md', '/work/todo.md', true, file);
        expect(server.paramsOf('workspace/willRenameFiles')).toEqual([]);
        expect(server.paramsOf('workspace/didRenameFiles')).toHaveLength(1);
        expect(calls).toEqual(['move', 'move']);
    });

    it('does not move when an edit does not fit the text, or the editor does not make it', async () => {
        const unfit = await moveRig(() => ({
            documentChanges: [
                { ...line('/work/src/b.ts', 'c'), edits: [{ range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } }, newText: 'x' }] }
            ]
        }));
        await expect(unfit.host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, unfit.file)).rejects.toMatchObject({ code: 'language-failed' });
        expect(unfit.calls).toEqual([]);
    });

    it('does not move when the editor refuses the edit', async () => {
        const { host, calls, file, events } = await moveRig(importEdits);
        const moving = host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file);
        const outcome = moving.then(
            () => 'moved',
            (error: { message: string }) => error.message
        );
        await until(() => kinds(events['client-1'], 'language.edit').length > 0);
        const [asked] = kinds(events['client-1'], 'language.edit');
        host.answerEdit('client-1', {
            projectId: 'p1',
            editId: (asked as { payload: { editId: string } }).payload.editId,
            applied: false,
            failureReason: 'Read only'
        });
        expect(await outcome).toBe('Read only');
        expect(calls).toEqual([]);
    });

    it('only moves when no server of the project is up', async () => {
        const { host, calls, file } = await moveRig(importEdits);
        expect(await host.renameFiles('client-1', 'other', aToC.from, aToC.to, true, file)).toEqual([]);
        expect(calls).toEqual(['move']);
    });
});
