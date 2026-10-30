import { afterEach, beforeEach, describe, expect, it } from 'bun:test';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join, resolve, sep } from 'node:path';
import { pathToFileUri } from '@adecore/lsp';
import { LANGUAGE_ERROR_CODES, type LanguageServerKind } from '@ruimte/contracts';
import { CodedError } from '@adecore/agents';
import { FakeWatch } from '@adecore/agents/testing';
import type { SessionEvent } from '../sessions/manager.ts';
import { LanguageChoices } from './choices.ts';
import { CustomLanguageServers } from './custom.ts';
import { LanguageHost } from './host.ts';
import { NativePolicy, nativeProgramFile, type Download } from './native.ts';
import { KIND_PROFILES, type CatalogKind, type ProjectSqlSettings } from './profiles.ts';
import { FULL_CAPABILITIES, fakeSpawner, makeAlternatives, ManualClock, settle, type FakeProcess, type FakeSpawner } from './test-fakes.ts';
import { tarGz } from './test-archives.ts';
import { LANGUAGE_KIND_PACKAGES, pinnedVersionsOf, versionOf, type NpmKind } from './versions.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';

let root = '';

const WORK = resolve('/work');
const MACHINE_STATE = resolve('/home/.ruimte');

/* The URI a server knows a file of the project by. */
function uri(path: string): string {
    return pathToFileUri(join(WORK, path));
}

const STUBS_COMMIT = 'c'.repeat(40);

const stubsDownload: Download = async (_url, destination) => {
    await writeFile(destination, tarGz([{ path: `stubs/standard/a.php`, text: '<?php' }]));
};

const newHome = tempHomes('ruimte-language-host-');

beforeEach(async () => {
    root = await newHome();
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
        folders?: string[];
        /* The revision of the checkout the PHP server builds from; none to read by default. */
        revision?: () => string | null;
        sqlSettings?: (projectId: string) => Promise<ProjectSqlSettings | null>;
        /* The folders made from another machine's work. */
        untrusted?: string[];
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
        folderOf: (projectId) => (projectId === 'p1' ? WORK : null),
        holders: () => [...holders],
        findProgram: () => [],
        machineHome: {
            refuse: async (path) => {
                if (path.startsWith(`${MACHINE_STATE}${sep}`)) {
                    throw new Refused('machine-state', `${path} belongs to this machine's own state`);
                }
            }
        },
        runtime: { command: '/ruimte', args: [], env: { BUN_BE_BUN: '1' } },
        spawn: spawner.spawn,
        native:
            options.native ?? new NativePolicy({ checkouts: { 'php-native': { folder: join(root, 'repo'), version: '0.1.0', stubsCommit: STUBS_COMMIT } } }),
        download: stubsDownload,
        checkoutRevision: async () => options.revision?.() ?? null,
        run: async (spec, onLine) => {
            if (spec.command.endsWith(nativeProgramFile('php-native', process.platform))) {
                onLine('php-language-server 0.1.0');
                return 0;
            }
            if (spec.args[0] === 'build') {
                installs.push('php-native');
                await mkdir(join(spec.cwd, 'target', 'release'), { recursive: true });
                await writeFile(join(spec.cwd, 'target', 'release', nativeProgramFile('php-native', process.platform)), '');
                return 0;
            }
            if (spec.args.includes('--version')) {
                onLine(`Version ${versionOf('typescript')}`);
                return 0;
            }
            // A package set installs in a staging folder that names no kind: it stands for every kind that pins these packages, and the first of them is the one the install is counted for.
            const { dependencies } = JSON.parse(await readFile(join(spec.cwd, 'package.json'), 'utf8')) as { dependencies: Record<string, string> };
            const kinds = (Object.keys(LANGUAGE_KIND_PACKAGES) as NpmKind[]).filter(
                (candidate) => JSON.stringify(pinnedVersionsOf(candidate)) === JSON.stringify(dependencies)
            );
            installs.push(kinds[0]!);
            for (const component of kinds.flatMap((kind) => KIND_PROFILES[kind].components)) {
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
        exists: async (path) => (options.files ?? []).includes(path) || (options.folders ?? []).includes(path),
        isFolder: async (path) => (options.folders ?? []).includes(path),
        readText: async (path) => (path === join(WORK, 'package.json') ? (options.packageJson ?? null) : (options.texts?.[path] ?? null)),
        ...(options.sqlSettings === undefined ? {} : { sqlSettings: options.sqlSettings }),
        untrusted: (path) => (options.untrusted ?? []).some((folder) => path === folder || path.startsWith(`${folder}${sep}`))
    });
    const events: Record<string, SessionEvent[]> = { 'client-1': [], 'client-2': [] };
    const heard = new Set<(event: SessionEvent) => void>();
    listeners.set(host, heard);
    for (const clientId of Object.keys(events)) {
        host.subscribe(clientId, (event) => {
            events[clientId].push(event);
            if (clientId === 'client-1') {
                heard.forEach((listener) => listener(event));
            }
        });
    }
    return { host, spawner, holders, events, installs, clock, watch, disk };
}

async function installed(
    kinds: CatalogKind[] = ['typescript'],
    options: {
        packageJson?: string;
        files?: string[];
        spawner?: FakeSpawner;
        platform?: NodeJS.Platform;
        native?: NativePolicy;
        texts?: Record<string, string>;
        folders?: string[];
        sqlSettings?: (projectId: string) => Promise<ProjectSqlSettings | null>;
        untrusted?: string[];
    } = {}
): Promise<Rig> {
    const choices = new LanguageChoices({ path: join(root, 'choices.json') });
    await choices.load();
    const result = rig({ ...options, choices });
    const ended = installsEnd(result.host, kinds);
    for (const kind of kinds) {
        await result.host.install(kind);
    }
    await ended;
    await settle();
    return result;
}

const listeners = new WeakMap<LanguageHost, Set<(event: SessionEvent) => void>>();

/* What a host's client-1 hears; a host made without the rig gets a client of its own for it. */
function listen(host: LanguageHost, listener: (event: SessionEvent) => void): () => void {
    let heard = listeners.get(host);
    if (heard === undefined) {
        const own = new Set<(event: SessionEvent) => void>();
        host.subscribe('observer', (event) => own.forEach((each) => each(event)));
        listeners.set(host, own);
        heard = own;
    }
    heard.add(listener);
    return () => heard.delete(listener);
}

/*
 * Waits until the check holds, looking now and again after every event of the host. The install and the
 * start of a server read real files, which no count of turns of the event loop waits for, and both end on an event.
 */
function until(host: LanguageHost, check: () => boolean | Promise<boolean>): Promise<void> {
    const { promise, resolve, reject } = Promise.withResolvers<void>();
    let checking = false;
    let again = false;
    const look = async (): Promise<void> => {
        if (checking) {
            again = true;
            return;
        }
        checking = true;
        try {
            do {
                again = false;
                if (await check()) {
                    stop();
                    resolve();
                    return;
                }
            } while (again);
        } catch (error) {
            stop();
            reject(error);
            return;
        }
        checking = false;
    };
    const stop = listen(host, () => void look());
    void look();
    return promise;
}

/* Resolves once the install of every kind ended, on the status the machine sends last for it; call before the installs start. */
function installsEnd(host: LanguageHost, kinds: readonly string[]): Promise<void> {
    const ended = new Set<string>();
    // Heard before the wait's own listener, so an end is noted before the wait looks on the same event.
    const stop = listen(host, (event) => {
        if (event.event !== 'language.status') {
            return;
        }
        const { projectId, status } = (event as { payload: { projectId: string | null; status: { server: string; state: string } } }).payload;
        // The start of an install always says installing, so any other state is its end.
        if (projectId === null && kinds.includes(status.server) && status.state !== 'installing') {
            ended.add(status.server);
        }
    });
    return until(host, () => kinds.every((kind) => ended.has(kind))).finally(stop);
}

async function ready(host: LanguageHost, server = 'typescript'): Promise<void> {
    await until(host, async () => (await host.status('p1')).find((status) => status.server === server)?.state === 'ready');
    await settle();
}

async function openReady(host: LanguageHost, path = 'src/a.ts', text = 'let a = 1;\n', clientId = 'client-1', languageId = 'typescript') {
    const result = await open(host, path, text, clientId, languageId);
    await ready(host);
    return result;
}

const open = (host: LanguageHost, path = 'src/a.ts', text = 'let a = 1;\n', clientId = 'client-1', languageId = 'typescript') =>
    host.open(clientId, { projectId: 'p1', path, languageId, text });

/* The id a client answers a `language.edit` with. */
function editIdOf(event: SessionEvent | undefined): string {
    return (event as { payload: { editId: string } }).payload.editId;
}

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
        expect(spawner.of('typescript')[0].server.documents.has(uri('src/main.ts'))).toBe(true);
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
        expect(live.server.documents.has(uri('src/main.ts'))).toBe(true);
        expect((await host.status('p1')).find((status) => status.server === 'typescript')?.state).toBe('stopped');
    });
});

describe('a save', () => {
    const saving = { textDocumentSync: { change: 2, willSave: true, save: { includeText: true } } } as const;

    it('sends willSave with the reason of the client to the servers of the document', async () => {
        const spawner = fakeSpawner({ typescript: saving });
        const { host } = await installed(['typescript'], { spawner });
        await openReady(host);

        await host.willSave({ projectId: 'p1', path: 'src/a.ts', reason: 3 });
        await settle();

        expect(spawner.processes[0]!.server.paramsOf('textDocument/willSave')).toEqual([{ textDocument: { uri: uri('src/a.ts') }, reason: 3 }]);
    });

    it('refuses willSave for a document that is not open', async () => {
        const { host } = await installed();

        await expect(host.willSave({ projectId: 'p1', path: 'src/a.ts', reason: 1 })).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.documentNotOpen });
    });

    it('sends didSave when the written text is the text the servers hold', async () => {
        const spawner = fakeSpawner({ typescript: saving });
        const { host } = await installed(['typescript'], { spawner });
        await openReady(host);

        await host.saved(join(WORK, 'src/a.ts'), 'let a = 1;\n');
        await settle();

        expect(spawner.processes[0]!.server.paramsOf('textDocument/didSave')).toEqual([{ textDocument: { uri: uri('src/a.ts') }, text: 'let a = 1;\n' }]);
    });

    it('sends nothing for a write of other text, or of a file that is no document', async () => {
        const spawner = fakeSpawner({ typescript: saving });
        const { host } = await installed(['typescript'], { spawner });
        await openReady(host);

        await host.saved(join(WORK, 'src/a.ts'), 'let a = 2;\n');
        await host.saved(join(WORK, 'src/other.ts'), 'let a = 1;\n');
        await settle();

        expect(spawner.processes[0]!.server.paramsOf('textDocument/didSave')).toEqual([]);
    });
});

describe('documents', () => {
    it('opens a document at version 1 and brings the server up for it', async () => {
        const { host, spawner } = await installed();
        const result = await open(host);
        expect(result).toEqual({ version: 1, servers: ['typescript'], providers: {} });
        await ready(host);
        expect(spawner.processes).toHaveLength(1);
        expect(spawner.processes[0].server.documents.get(uri('src/a.ts'))?.text).toBe('let a = 1;\n');
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
        expect(spawner.processes[0].server.documents.get(uri('src/a.ts'))).toEqual({ languageId: 'typescript', text: 'let a = 123;\n', version: 3 });
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
        expect(spawner.processes[0].server.documents.get(uri('src/a.ts'))).toEqual({ languageId: 'typescript', text: 'let a = 1;\n', version: 1 });
        expect(await open(host, 'src/a.ts', 'let a = 2;\n')).toMatchObject({ version: 2 });
    });

    it('shares one document between clients, replaces its text when another opens with different text, and keeps it until the last closes', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        expect((await open(host, 'src/a.ts', 'let a = 1;\n', 'client-2')).version).toBe(1);
        expect((await open(host, 'src/a.ts', 'let a = 9;\n', 'client-2')).version).toBe(2);
        await settle();
        expect(spawner.processes[0].server.documents.get(uri('src/a.ts'))?.text).toBe('let a = 9;\n');
        await host.closeDocument('client-1', { projectId: 'p1', path: 'src/a.ts' });
        await settle();
        expect(spawner.processes[0].server.documents.has(uri('src/a.ts'))).toBe(true);
        await host.closeDocument('client-2', { projectId: 'p1', path: 'src/a.ts' });
        await settle();
        expect(spawner.processes[0].server.documents.has(uri('src/a.ts'))).toBe(false);
        await expect(host.change({ projectId: 'p1', path: 'src/a.ts', baseVersion: 2, changes: [{ text: '' }] })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.documentNotOpen
        });
    });

    it('names a file the same whether the path is relative or absolute', async () => {
        const { host, spawner } = await installed();
        await openReady(host, 'src/a.ts');
        await open(host, join(WORK, 'src/../src/a.ts'), 'let a = 1;\n', 'client-2');
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
        const server = spawner.processes[0].server;
        expect([...server.documents.keys()]).toEqual([uri('src/a.ts')]);
        unsubscribe();
        await settle();
        expect(server.paramsOf('textDocument/didClose')).toEqual([{ textDocument: { uri: uri('src/a.ts') } }]);
        expect(server.documents.size).toBe(0);
        await expect(host.change({ projectId: 'p1', path: 'src/a.ts', baseVersion: 1, changes: [{ text: '' }] })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.documentNotOpen
        });
        expect(server.exited).toBe(false);
    });

    it('holds no document for a client whose socket went while the open was under way', async () => {
        const { host, spawner } = await installed();
        const unsubscribe = host.subscribe('client-3', () => undefined);
        const opening = open(host, 'src/a.ts', 'let a = 1;\n', 'client-3');
        unsubscribe();
        await expect(opening).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.unavailable });
        await expect(host.change({ projectId: 'p1', path: 'src/a.ts', baseVersion: 1, changes: [{ text: '' }] })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.documentNotOpen
        });
        expect(spawner.processes).toHaveLength(0);
    });

    it('starts no server for a project that ended while a document opened', async () => {
        const { host, spawner } = await installed();
        const opening = open(host);
        await host.end('p1');
        await expect(opening).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.projectNotFound });
        await settle();
        expect(spawner.processes).toHaveLength(0);
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
    const eslintFiles = [join(WORK, 'eslint.config.js')];
    const caps = (extra: object = {}) => ({ textDocumentSync: 2 as const, hoverProvider: true, ...extra });

    it('adds ESLint to the kind of the language in a project that has an ESLint config, and nothing without one', async () => {
        const { host, spawner } = await installed(['typescript', 'eslint'], { files: eslintFiles });
        expect((await open(host)).servers).toEqual(['typescript', 'eslint']);
        await ready(host);
        await ready(host, 'eslint');
        expect(spawner.of('eslint')[0]!.server.documents.has(uri('src/a.ts'))).toBe(true);
        expect(spawner.of('typescript')[0]!.server.documents.has(uri('src/a.ts'))).toBe(true);
        const without = await installed(['typescript', 'eslint']);
        expect((await open(without.host)).servers).toEqual(['typescript']);
    });

    it('adds no server that runs project code to work another machine sent, in a folder of it or a project made of it', async () => {
        const inside = await installed(['typescript', 'eslint'], {
            files: [...eslintFiles, join(WORK, 'peer/eslint.config.js')],
            untrusted: [join(WORK, 'peer')]
        });
        expect((await open(inside.host)).servers).toEqual(['typescript', 'eslint']);
        expect((await open(inside.host, 'peer/src/a.ts')).servers).toEqual(['typescript']);

        const whole = await installed(['typescript', 'eslint'], { files: eslintFiles, untrusted: [WORK] });
        expect((await open(whole.host)).servers).toEqual(['typescript']);
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
        await spawner.of('eslint')[0]!.server.connection.notify('textDocument/publishDiagnostics', { uri: uri('src/a.ts'), version: 1, diagnostics: [item] });
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

    it('sends a call hierarchy follow-up to the server that made the item, and hands the server its own data back', async () => {
        const spawner = fakeSpawner({ typescript: caps({ callHierarchyProvider: true }), eslint: caps({ callHierarchyProvider: true }) });
        const { host } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
        const item = (name: string, data?: unknown) => ({
            name,
            kind: 12,
            uri: uri('src/a.ts'),
            range,
            selectionRange: range,
            ...(data === undefined ? {} : { data })
        });
        const [tsserver, eslint] = [spawner.of('typescript')[0]!.server, spawner.of('eslint')[0]!.server];
        eslint.handle('textDocument/prepareCallHierarchy', () => [item('rule', { id: 7 })]);
        eslint.handle('callHierarchy/incomingCalls', () => [{ from: item('caller'), fromRanges: [range] }]);
        tsserver.handle('callHierarchy/incomingCalls', () => []);
        const base = { projectId: 'p1', path: 'src/a.ts' };
        const prepared = await host.request({ ...base, method: 'textDocument/prepareCallHierarchy', params: {}, server: 'eslint' });
        const [made] = prepared.result as Array<{ data: unknown }>;
        const incoming = await host.request({ ...base, method: 'callHierarchy/incomingCalls', params: { item: made } });
        expect(eslint.paramsOf('callHierarchy/incomingCalls')).toEqual([{ item: item('rule', { id: 7 }) }]);
        expect(tsserver.paramsOf('callHierarchy/incomingCalls')).toEqual([]);
        expect(incoming.server).toBe('eslint');
        const [call] = incoming.result as Array<{ from: { data: unknown } }>;
        tsserver.handle('callHierarchy/outgoingCalls', () => []);
        eslint.handle('callHierarchy/outgoingCalls', () => []);
        await host.request({ ...base, method: 'callHierarchy/outgoingCalls', params: { item: call.from } });
        expect(eslint.paramsOf('callHierarchy/outgoingCalls')).toEqual([{ item: item('caller') }]);
        expect(tsserver.paramsOf('callHierarchy/outgoingCalls')).toEqual([]);
    });

    it('sends a type hierarchy follow-up to the server that made the item', async () => {
        const spawner = fakeSpawner({ typescript: caps({ typeHierarchyProvider: true }), eslint: caps({ typeHierarchyProvider: true }) });
        const { host } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
        const item = (name: string, data?: unknown) => ({
            name,
            kind: 5,
            uri: uri('src/a.ts'),
            range,
            selectionRange: range,
            ...(data === undefined ? {} : { data })
        });
        const [tsserver, eslint] = [spawner.of('typescript')[0]!.server, spawner.of('eslint')[0]!.server];
        eslint.handle('textDocument/prepareTypeHierarchy', () => [item('Base', { id: 3 })]);
        eslint.handle('typeHierarchy/supertypes', () => [item('Root')]);
        eslint.handle('typeHierarchy/subtypes', () => []);
        tsserver.handle('typeHierarchy/supertypes', () => []);
        tsserver.handle('typeHierarchy/subtypes', () => []);
        const base = { projectId: 'p1', path: 'src/a.ts' };
        const prepared = await host.request({ ...base, method: 'textDocument/prepareTypeHierarchy', params: {}, server: 'eslint' });
        const [made] = prepared.result as Array<{ data: unknown }>;
        const supertypes = await host.request({ ...base, method: 'typeHierarchy/supertypes', params: { item: made } });
        expect(eslint.paramsOf('typeHierarchy/supertypes')).toEqual([{ item: item('Base', { id: 3 }) }]);
        expect(tsserver.paramsOf('typeHierarchy/supertypes')).toEqual([]);
        expect(supertypes.server).toBe('eslint');
        const [root] = supertypes.result as Array<unknown>;
        await host.request({ ...base, method: 'typeHierarchy/subtypes', params: { item: root } });
        expect(eslint.paramsOf('typeHierarchy/subtypes')).toEqual([{ item: item('Root') }]);
        expect(tsserver.paramsOf('typeHierarchy/subtypes')).toEqual([]);
    });

    it('merges the links and colors of several servers, and resolves a link on the process that made it', async () => {
        const link = (line: number) => ({ range: { start: { line, character: 0 }, end: { line, character: 3 } }, target: `https://example.test/${line}` });
        const spawner = fakeSpawner({
            typescript: caps({ documentLinkProvider: { resolveProvider: true } }),
            eslint: caps({ documentLinkProvider: { resolveProvider: true }, colorProvider: true })
        });
        const { host } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        const [tsserver, eslint] = [spawner.of('typescript')[0]!.server, spawner.of('eslint')[0]!.server];
        tsserver.handle('textDocument/documentLink', () => [link(0)]);
        eslint.handle('textDocument/documentLink', () => [link(1)]);
        eslint.handle('documentLink/resolve', (params) => ({ ...(params as object), tooltip: 'from eslint' }));
        const base = { projectId: 'p1', path: 'src/a.ts' };
        const links = await host.request({ ...base, method: 'textDocument/documentLink', params: {} });
        expect(links.result).toEqual([link(0), link(1)]);
        expect(links.itemServers).toEqual(['typescript', 'eslint']);
        const resolved = await host.request({ ...base, method: 'documentLink/resolve', params: link(1), server: 'eslint' });
        expect(resolved).toMatchObject({ result: { tooltip: 'from eslint' }, server: 'eslint' });
    });

    it('asks a Vue project for a type hierarchy and falls through to the TypeScript server when Vue lacks it', async () => {
        const spawner = fakeSpawner({ typescript: caps({ typeHierarchyProvider: true }), vue: caps() });
        const { host } = await installed(['typescript', 'vue'], { packageJson: JSON.stringify({ dependencies: { vue: '^3.5.0' } }), spawner });
        await open(host);
        await ready(host, 'vue');
        const tsserver = spawner.of('typescript').at(-1)!.server;
        tsserver.handle('textDocument/prepareTypeHierarchy', () => []);
        const answer = await host.request({
            projectId: 'p1',
            path: 'src/a.ts',
            method: 'textDocument/prepareTypeHierarchy',
            params: { position: { line: 0, character: 0 } }
        });
        expect(answer.server).toBe('typescript');
        expect(tsserver.paramsOf('textDocument/prepareTypeHierarchy')).toHaveLength(1);
    });

    it('routes a call hierarchy follow-up normally, with the item unwrapped, when the server that made it no longer serves the document', async () => {
        const spawner = fakeSpawner({ typescript: caps({ callHierarchyProvider: true }) });
        const { host } = await installed(['typescript'], { spawner });
        await open(host);
        await ready(host);
        const range = { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } };
        const stale = {
            name: 'rule',
            kind: 12,
            uri: uri('src/a.ts'),
            range,
            selectionRange: range,
            data: { $ruimteServer: 'eslint', data: { id: 7 } }
        };
        const tsserver = spawner.of('typescript')[0]!.server;
        tsserver.handle('callHierarchy/incomingCalls', () => []);
        const answer = await host.request({ projectId: 'p1', path: 'src/a.ts', method: 'callHierarchy/incomingCalls', params: { item: stale } });
        expect(answer.server).toBe('typescript');
        const { data: _gone, ...bare } = stale;
        expect(tsserver.paramsOf('callHierarchy/incomingCalls')).toEqual([{ item: bare }]);
    });

    it('keeps primary suggestions and logs a malformed default range from a secondary server', async () => {
        const spawner = fakeSpawner({ typescript: caps({ completionProvider: {} }), eslint: caps({ completionProvider: {} }) });
        const { host } = await installed(['typescript', 'eslint'], { files: eslintFiles, spawner });
        await open(host);
        await ready(host);
        await ready(host, 'eslint');
        spawner.of('typescript')[0]!.server.handle('textDocument/completion', () => [{ label: 'primary' }]);
        spawner.of('eslint')[0]!.server.handle('textDocument/completion', () => ({
            isIncomplete: false,
            itemDefaults: { editRange: {}, insertTextFormat: 2, insertTextMode: 2 },
            items: [{ label: 'rule', insertText: 'rule($1)' }, { label: 'other' }]
        }));
        const answer = await host.request({
            projectId: 'p1',
            path: 'src/a.ts',
            method: 'textDocument/completion',
            params: { position: { line: 0, character: 0 } }
        });
        expect(answer.result).toEqual({
            isIncomplete: false,
            items: [
                { label: 'primary' },
                { label: 'rule', insertText: 'rule($1)', insertTextFormat: 2, insertTextMode: 2 },
                { label: 'other', insertTextFormat: 2, insertTextMode: 2 }
            ]
        });
        expect(answer.itemServers).toEqual(['typescript', 'eslint', 'eslint']);
        expect((await host.log('p1', 'eslint')).filter((line) => line.text.includes('Invalid completion default'))).toHaveLength(1);
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
        const late = Promise.withResolvers<unknown[]>();
        spawner.of('typescript')[0]!.server.handle('textDocument/completion', () => [{ label: 'toFixed' }]);
        spawner.of('eslint')[0]!.server.handle('textDocument/completion', () => late.promise);
        const asked = host.request({ projectId: 'p1', path: 'src/a.ts', method: 'textDocument/completion', params: { position: { line: 0, character: 0 } } });
        await settle();
        clock.fire();
        const answer = await asked;
        expect(answer.result).toEqual({ isIncomplete: false, items: [{ label: 'toFixed' }] });
        expect(answer.itemServers).toEqual(['typescript']);
        late.resolve([{ label: 'late' }]);
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
        const slow = Promise.withResolvers<unknown>();
        spawner.of('typescript')[0]!.server.handle('textDocument/hover', () => slow.promise);
        spawner.of('eslint')[0]!.server.handle('textDocument/hover', () => ({ contents: { kind: 'markdown', value: 'rule docs' } }));
        const asked = host.request({ projectId: 'p1', path: 'src/a.ts', method: 'textDocument/hover', params: {} });
        await settle();
        clock.fire();
        await settle();
        slow.resolve({ contents: { kind: 'markdown', value: 'types' } });
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
        expect(process!.spec).toMatchObject({ command: 'zls', args: ['--stdio'], cwd: WORK, env: { ZLS_LOG: '1' } });
        expect(process!.spec.env.BUN_BE_BUN).toBeUndefined();
        expect(process!.server.received.find((message) => message.method === 'initialize')?.params).toMatchObject({
            initializationOptions: { snippets: true }
        });
        process!.server.handle('textDocument/hover', () => ({ contents: 'zig hover' }));
        expect(await host.request({ projectId: 'p1', path: 'src/main.zig', method: 'textDocument/hover', params: {} })).toMatchObject({
            result: { contents: 'zig hover' },
            server: saved.id
        });
        await process!.server.connection.notify('textDocument/publishDiagnostics', { uri: uri('src/main.zig'), version: 1, diagnostics: [] });
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
        expect(spawner.of('zls')[0]!.server.documents.has(uri('src/main.zig'))).toBe(true);
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
        await until(host, () => spawner.of('zls').length === 2);
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
            folderOf: () => WORK,
            holders: () => [],
            machineHome: { refuse: async () => undefined },
            spawn: spawner.spawn,
            findProgram: () => [],
            custom: second
        });
        held.subscribe('client-1', () => undefined);
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
    const edit = { changes: { [uri('src/a.ts')]: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 3 } }, newText: 'const' }] } };

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

    it('runs the commands of two clients on one server one after the other, so an edit goes to the client whose command asked', async () => {
        const { host, server, events } = await commandRig();
        server.handle('workspace/executeCommand', async (params) => ({
            applied: await server.request('workspace/applyEdit', { label: (params as { command: string }).command, edit })
        }));
        const first = host.command('client-1', { projectId: 'p1', path: 'src/a.ts', command: 'first' });
        const second = host.command('client-2', { projectId: 'p1', path: 'src/a.ts', command: 'second' });
        await settle();
        expect(server.paramsOf('workspace/executeCommand')).toEqual([{ command: 'first' }]);
        const [asked] = kinds(events['client-1'], 'language.edit');
        expect(asked).toMatchObject({ payload: { label: 'first' } });
        expect(kinds(events['client-2'], 'language.edit')).toHaveLength(0);

        host.answerEdit('client-1', { projectId: 'p1', editId: editIdOf(asked), applied: true });
        expect((await first).result).toEqual({ applied: { applied: true } });
        await settle();
        const [next] = kinds(events['client-2'], 'language.edit');
        expect(next).toMatchObject({ payload: { label: 'second' } });
        host.answerEdit('client-2', { projectId: 'p1', editId: editIdOf(next), applied: true });
        expect((await second).result).toEqual({ applied: { applied: true } });
        expect(await server.request('workspace/applyEdit', { edit })).toMatchObject({ applied: false });
    });

    it('skips a waiting command of a client that went away before its turn', async () => {
        const { host, server } = await commandRig();
        const leave = host.subscribe('client-3', () => undefined);
        const { promise: release, resolve } = Promise.withResolvers<void>();
        server.handle('workspace/executeCommand', async (params) => {
            await release;
            return (params as { command: string }).command;
        });
        const first = host.command('client-1', { projectId: 'p1', path: 'src/a.ts', command: 'first' });
        const waiting = host.command('client-3', { projectId: 'p1', path: 'src/a.ts', command: 'waiting' });
        await settle();
        leave();
        resolve();
        expect((await first).result).toBe('first');
        await expect(waiting).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.unavailable });
        expect(server.paramsOf('workspace/executeCommand')).toEqual([{ command: 'first' }]);
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
        await spawner.processes[0].server.publishDiagnostics(uri('src/a.ts'), [diagnostic], 1);
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

    it('keeps running an install of older versions, offers the pinned one, and starts its servers again on each switch', async () => {
        const { host, spawner } = rig();
        // What an update of Ruimte leaves: the install of the versions it pinned before, from before installs had a folder each.
        for (const component of KIND_PROFILES.typescript.components) {
            const entry = join(root, 'typescript', 'node_modules', component.entry);
            await mkdir(dirname(entry), { recursive: true });
            await writeFile(entry, '');
        }
        await writeFile(
            join(root, 'typescript', 'installed.json'),
            JSON.stringify({ versions: { typescript: '6.0.3', 'typescript-language-server': '6.0.1', 'typescript-6': 'npm:typescript@6.0.3' } })
        );
        await openReady(host);
        const status = async () => (await host.status('p1')).find((entry) => entry.server === 'typescript')!;
        expect(await status()).toMatchObject({ state: 'ready', version: '6.0.3', update: { version: '7.0.2' } });
        expect(spawner.of('typescript')[0]!.spec.command).toBe(join(root, 'typescript', 'node_modules', KIND_PROFILES.typescript.components[0]!.entry));

        await host.install('typescript');
        await until(host, async () => spawner.of('typescript').length === 2 && (await status()).state === 'ready');
        expect(spawner.of('typescript')[0]!.kills).toEqual(['SIGTERM']);
        expect(spawner.of('typescript')[1]!.spec.command).toContain(join(root, 'typescript', 'versions', '7.0.2-'));
        const updated = await status();
        expect(updated).toMatchObject({ version: '7.0.2', previous: { version: '6.0.3' } });
        expect(updated.update).toBeUndefined();

        expect(await host.rollback('typescript')).toMatchObject({ version: '6.0.3', previous: { version: '7.0.2' }, update: { version: '7.0.2' } });
        await until(host, async () => spawner.of('typescript').length === 3 && (await status()).state === 'ready');
        expect(spawner.of('typescript')[2]!.spec.command).toBe(join(root, 'typescript', 'node_modules', KIND_PROFILES.typescript.components[0]!.entry));
    });

    it('refuses a step back for a kind that has no earlier version', async () => {
        const { host } = await installed(['typescript']);
        await expect(host.rollback('typescript')).rejects.toMatchObject({ code: 'language-failed', message: expect.stringContaining('no earlier version') });
    });

    it('offers a build of a checkout that changed since the last one, read when the servers are asked for', async () => {
        let revision = 'aaa';
        const { host } = rig({ revision: () => revision });
        await host.install('php-native');
        await until(host, async () => (await host.status('p1')).find((status) => status.server === 'php-native')?.state === 'stopped');
        expect((await host.status('p1')).find((status) => status.server === 'php-native')?.update).toBeUndefined();
        revision = 'bbb';
        expect((await host.status('p1')).find((status) => status.server === 'php-native')).toMatchObject({ update: { version: '0.1.0', rebuild: true } });
    });

    it('answers a failed install as not installed, with the reason', async () => {
        const failing = rig();
        const host = new LanguageHost({
            root,
            folderOf: () => WORK,
            holders: () => [],
            machineHome: { refuse: async () => undefined },
            run: async () => 1,
            findProgram: () => [],
            spawn: failing.spawner.spawn
        });
        await host.install('css');
        const css = async () => (await host.status('p1')).find((status) => status.server === 'css')!;
        await until(host, async () => (await css()).message !== undefined);
        expect(await css()).toMatchObject({ server: 'css', state: 'not-installed', message: 'The installer exited with code 1' });
    });

    it('restarts a crashed server on request and says how it ended up', async () => {
        const { host, spawner } = await installed();
        await openReady(host);
        await spawner.processes[0].crash();
        await settle();
        expect((await host.status('p1'))[0]).toMatchObject({ state: 'crashed' });
        expect(await host.restart('p1', 'typescript')).toMatchObject({ state: 'ready' });
        expect(spawner.processes).toHaveLength(2);
        expect(spawner.processes[1].server.documents.has(uri('src/a.ts'))).toBe(true);
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
    it('reaches a server for a file created beside the one that is open', async () => {
        const { host, spawner, watch, disk } = await installed(['python']);
        await open(host, 'main.py', 'import gener\n', 'client-1', 'python');
        await ready(host, 'python');
        const [python] = spawner.of('python');
        expect(watch.watchers).toHaveLength(0);

        await registerWatchers(python, 'python-files', [{ globPattern: '**/*.{py,pyi}' }]);
        expect(watch.openOn(WORK)).toHaveLength(1);

        disk.add(join(WORK, 'Generated.py'));
        watch.on(WORK).emit('Generated.py', 'rename');
        watch.on(WORK).emit('notes.txt', 'rename');
        expect(watch.pending).toBe(1);
        await watch.settle();
        expect(python.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: uri('Generated.py'), type: 1 }] }]);
    });

    it('hands the PHP server of Ruimte the files of other languages its patterns name, without looking at their language', async () => {
        const { host, spawner, watch, disk } = await installed(['php-native']);
        await open(host, 'src/a.php', '<?php', 'client-1', 'php');
        await ready(host, 'php-native');
        const [php] = spawner.of('php-native');
        // What the server registers in its release 0.4.1.
        const globs = [
            '**/*.php',
            '**/composer.json',
            '**/vendor/composer/installed.json',
            '**/vendor/composer/autoload_classmap.php',
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
            'vendor/composer/installed.json',
            'vendor/composer/autoload_classmap.php'
        ];
        for (const path of changed) {
            disk.add(join(WORK, path));
            watch.on(WORK).emit(path, 'change');
        }
        watch.on(WORK).emit('resources/js/Components/Button.vue', 'change');
        watch.on(WORK).emit('vendor/laravel/framework/src/Foundation/Application.php', 'change');
        await watch.settle();
        const [{ changes }] = php!.server.paramsOf('workspace/didChangeWatchedFiles') as [{ changes: { uri: string }[] }];
        expect(changes.map((change) => change.uri).sort()).toEqual(changed.map((path) => uri(path)).sort());
    });

    it('tells a server that a file changed or went, in one batch per burst', async () => {
        const { host, spawner, watch, disk } = await installed(['python']);
        await open(host, 'main.py', 'import os', 'client-1', 'python');
        await ready(host, 'python');
        const [python] = spawner.of('python');
        await registerWatchers(python, 'python-files', [{ globPattern: '**/*.py' }]);

        disk.add(join(WORK, 'src/Kept.py'));
        watch.on(WORK).emit('src/Kept.py', 'change');
        watch.on(WORK).emit('src/Gone.py', 'rename');
        watch.on(WORK).emit('src/Kept.py', 'change');
        await watch.settle();
        expect(python.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([
            {
                changes: [
                    { uri: uri('src/Gone.py'), type: 3 },
                    { uri: uri('src/Kept.py'), type: 2 }
                ]
            }
        ]);
    });

    it('leaves dependency folders alone unless a server named them, and skips a directory that appeared', async () => {
        const { host, spawner, watch } = await installed(['python']);
        await open(host, 'main.py', 'import os', 'client-1', 'python');
        await ready(host, 'python');
        const [python] = spawner.of('python');
        await registerWatchers(python, 'python-files', [{ globPattern: '**/*.py' }]);

        watch.on(WORK).emit('vendor/acme/Thing.py', 'change');
        watch.on(WORK).emit('node_modules/x/Thing.py', 'change');
        expect(watch.pending).toBe(0);

        await registerWatchers(python, 'vendor-files', [{ globPattern: 'vendor/composer/installed.json' }]);
        watch.on(WORK).emit('vendor/composer/installed.json', 'change');
        expect(watch.pending).toBe(1);
    });

    it('sends the change of an ESLint or Tailwind config only to the server that registered for it', async () => {
        const { host, spawner, watch, disk } = await installed(['typescript', 'eslint', 'tailwind'], {
            files: [join(WORK, 'eslint.config.js'), join(WORK, 'tailwind.config.js')]
        });
        await open(host, 'src/a.ts', 'let a = 1;\n');
        await until(host, async () => spawner.of('eslint').length > 0 && spawner.of('tailwind').length > 0 && spawner.of('typescript').length > 0);
        await settle();
        const [eslint] = spawner.of('eslint');
        const [tailwind] = spawner.of('tailwind');
        const [typescript] = spawner.of('typescript');
        await registerWatchers(eslint, 'eslint-config', [{ globPattern: '**/eslint.config.*' }, { globPattern: '**/package.json' }]);
        await registerWatchers(tailwind, 'tailwind-config', [{ globPattern: '**/tailwind.config.{js,cjs,mjs,ts}' }]);

        disk.add(join(WORK, 'eslint.config.js'));
        disk.add(join(WORK, 'tailwind.config.js'));
        watch.on(WORK).emit('eslint.config.js', 'change');
        watch.on(WORK).emit('tailwind.config.js', 'change');
        await watch.settle();
        expect(eslint.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: uri('eslint.config.js'), type: 2 }] }]);
        expect(tailwind.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: uri('tailwind.config.js'), type: 2 }] }]);
        expect(typescript.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([]);
    });

    it('stops watching when no server asks any more, and when the project closes', async () => {
        const { host, spawner, watch } = await installed(['python']);
        await open(host, 'main.py', 'import os', 'client-1', 'python');
        await ready(host, 'python');
        const [python] = spawner.of('python');
        await registerWatchers(python, 'python-files', [{ globPattern: '**/*.py' }]);
        expect(watch.openOn(WORK)).toHaveLength(1);

        await python.server.request('client/unregisterCapability', { unregisterations: [{ id: 'python-files', method: 'workspace/didChangeWatchedFiles' }] });
        await settle();
        expect(watch.openOn(WORK)).toHaveLength(0);

        await registerWatchers(python, 'python-again', [{ globPattern: '**/*.py' }]);
        expect(watch.openOn(WORK)).toHaveLength(1);
        await host.end('p1');
        expect(watch.openOn(WORK)).toHaveLength(0);
    });

    it('watches the directories of the open documents where a tree cannot be watched in one call', async () => {
        const { host, spawner, watch, disk } = await installed(['python'], { platform: 'linux' });
        await open(host, 'src/Models/User.py', 'import os', 'client-1', 'python');
        await ready(host, 'python');
        const [python] = spawner.of('python');
        await registerWatchers(python, 'python-files', [{ globPattern: '**/*.py' }]);
        expect(watch.openOn(WORK)[0]?.recursive).toBe(false);
        await open(host, 'src/Http/Controller.py', 'import os', 'client-1', 'python');
        expect(watch.openOn(join(WORK, 'src/Models'))).toHaveLength(1);
        expect(watch.openOn(join(WORK, 'src/Http'))).toHaveLength(1);

        disk.add(join(WORK, 'src/Models/Post.py'));
        watch.on(join(WORK, 'src/Models')).emit('Post.py', 'rename');
        await watch.settle();
        expect(python.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: uri('src/Models/Post.py'), type: 1 }] }]);
    });
});

describe('the retired kind `php`, Intelephense', () => {
    it('serves PHP with the server of Ruimte, whatever an older Ruimte stored, and lists no other', async () => {
        await writeFile(join(root, 'choices.json'), JSON.stringify({ picks: { php: 'php' } }));
        const { host } = await installed(['php-native']);
        const statuses = await host.status('p1');
        expect(statuses.map((status) => status.server)).not.toContain('php');
        expect(statuses.find((status) => status.server === 'php-native')).toMatchObject({ version: '0.1.0' });
        expect(statuses.find((status) => status.server === 'php-native')?.chosen).toBeUndefined();
        expect((await open(host, 'src/a.php', '<?php', 'client-1', 'php')).servers).toEqual(['php-native']);
    });

    it('refuses to install, set back or prefer it, and answers the rest like a server that does not exist', async () => {
        const { host, installs } = await installed(['typescript']);
        installs.length = 0;
        await expect(host.install('php')).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.invalidServer });
        await expect(host.rollback('php')).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.invalidServer });
        await expect(host.prefer('php')).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.invalidServer });
        expect(installs).toEqual([]);
        expect(await host.restart('p1', 'php')).toMatchObject({ server: 'php', state: 'stopped', documents: 0 });
        expect(await host.log('p1', 'php')).toEqual([]);
        await expect(host.trace('p1', 'php', 'off')).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.unavailable });
    });
});

describe('the choice between two servers of a language', () => {
    let restore = (): void => undefined;

    beforeEach(() => {
        restore = makeAlternatives();
    });

    afterEach(() => {
        restore();
    });

    it('moves the open documents to the other server, clears what the first reported and ends it', async () => {
        const { host, spawner, events } = await installed(['css', 'yaml']);
        await open(host, 'src/a.css', 'a {}', 'client-1', 'css');
        await ready(host, 'css');
        const [first] = spawner.of('css');
        events['client-1'].length = 0;
        const status = await host.prefer('yaml');
        expect(status).toMatchObject({ server: 'yaml', chosen: true });
        await ready(host, 'yaml');
        await settle();
        expect(first!.kills).toEqual(['SIGTERM']);
        expect((await host.status('p1')).find((entry) => entry.server === 'css')).toMatchObject({ state: 'stopped', chosen: false });
        expect((await open(host, 'src/a.css', 'a {}', 'client-1', 'css')).servers).toEqual(['yaml']);
        expect(kinds(events['client-1'], 'language.diagnostics').map((event) => (event as { payload: { server: string } }).payload.server)).toContain('css');
        const changed = kinds(events['client-1'], 'language.status').map(
            (event) => (event as { payload: { projectId: string | null; status: { server: string; chosen?: boolean } } }).payload
        );
        expect(changed).toEqual(
            expect.arrayContaining([
                { projectId: null, status: expect.objectContaining({ server: 'yaml', chosen: true }) },
                { projectId: null, status: expect.objectContaining({ server: 'css', chosen: false }) }
            ])
        );
        expect(JSON.parse(await readFile(join(root, 'choices.json'), 'utf8'))).toEqual({ picks: { css: 'yaml' } });
    });

    it('keeps the choice across a restart of the daemon', async () => {
        await writeFile(join(root, 'choices.json'), JSON.stringify({ picks: { css: 'yaml' } }));
        const { host } = await installed(['css', 'yaml']);
        expect((await host.status('p1')).find((status) => status.server === 'yaml')).toMatchObject({ chosen: true });
        expect((await open(host, 'src/a.css', 'a {}', 'client-1', 'css')).servers).toEqual(['yaml']);
    });

    it('refuses to choose a kind that has no alternative', async () => {
        const { host } = await installed(['typescript']);
        await expect(host.prefer('typescript')).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.invalidServer });
    });
});

describe('the PHP server of Ruimte', () => {
    it('runs the program of the kind with the storage and the stubs it installed', async () => {
        const { host, spawner } = await installed(['php-native']);
        await open(host, 'src/a.php', '<?php', 'client-1', 'php');
        await ready(host, 'php-native');
        const [process] = spawner.of('php-native');
        const install = join(root, 'php-native');
        expect(process!.spec.command).toBe(join(root, 'repo', 'target', 'release', nativeProgramFile('php-native', globalThis.process.platform)));
        expect(process!.spec.args).toEqual(['--stdio']);
        expect(process!.server.paramsOf('initialize')[0]).toMatchObject({
            initializationOptions: { storagePath: join(install, 'storage'), stubsPath: join(install, 'storage', 'stubs', STUBS_COMMIT) }
        });
    });

    it('keeps a PHP server in view of the cache pass until its processes exited after the project closed', async () => {
        const { host, spawner, clock } = await installed(['php-native']);
        await open(host, 'src/a.php', '<?php', 'client-1', 'php');
        await ready(host, 'php-native');
        const [php] = spawner.of('php-native');
        php!.stubborn = true;
        const ending = host.end('p1');
        await settle();

        expect(host.phpCache().liveFolders()).toEqual([WORK]);
        expect(host.phpCache().anyLive()).toBe(true);

        clock.fire();
        await ending;

        expect(host.phpCache().liveFolders()).toEqual([]);
        expect(host.phpCache().anyLive()).toBe(false);
    });

    it('serves a template of PHP by its name when the editor gave it no language', async () => {
        const { host } = await installed(['php-native']);
        expect((await open(host, 'views/page.phtml', '<p>', 'client-1', 'plaintext')).servers).toEqual(['php-native']);
    });

    it('serves Twig, Blade and the configuration of a Symfony project with the server of Ruimte', async () => {
        const { host } = await installed(['php-native', 'yaml'], { files: [join(WORK, 'composer.json')] });
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

    it('says a build with nothing to install is unavailable, and starts no install for it', async () => {
        const { host, installs } = await installed(['typescript'], { native: new NativePolicy({ checkouts: {}, releases: {} }) });
        expect((await host.status('p1')).find((status) => status.server === 'php-native')).toMatchObject({
            state: 'not-installed',
            version: '',
            unavailable: true
        });
        await host.install('php-native');
        await until(host, async () => (await host.status('p1')).find((status) => status.server === 'php-native')?.message !== undefined);
        expect((await host.status('p1')).find((status) => status.server === 'php-native')).toMatchObject({
            message: 'No release of this server is available yet'
        });
        expect(installs).toEqual(['typescript']);
    });
});

describe('files that move', () => {
    const filters = [{ scheme: 'file', pattern: { glob: '**/*.ts', matches: 'file' as const } }];
    const capabilities = { typescript: { ...FULL_CAPABILITIES, workspace: { fileOperations: { willRename: { filters }, didRename: { filters } } } } };
    const aToC = { from: join(WORK, 'src/a.ts'), to: join(WORK, 'src/c.ts') };
    const line = (path: string, text: string) => ({
        textDocument: { uri: pathToFileUri(path), version: null },
        edits: [{ range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } }, newText: text }]
    });

    async function moveRig(answer?: (params: unknown) => unknown, texts: Record<string, string> = {}, folders: string[] = []) {
        const spawner = fakeSpawner(capabilities, [], answer === undefined ? {} : { typescript: { 'workspace/willRenameFiles': answer } });
        const result = await installed(['typescript'], { spawner, texts: { [join(WORK, 'src/b.ts')]: 'import "./a";\n', ...texts }, folders });
        await openReady(result.host, 'src/a.ts', 'export "./a";\n');
        const calls: string[] = [];
        const written: Array<{ path: string; text: string }> = [];
        const file = {
            move: async () => void calls.push('move'),
            write: async (path: string, text: string) => {
                calls.push('write');
                written.push({ path, text });
            },
            create: async (path: string, text: string) => {
                calls.push('create');
                written.push({ path, text });
            },
            rename: async (from: string, to: string, overwrite: boolean) => void calls.push(`rename ${from} ${to}${overwrite ? ' overwrite' : ''}`),
            delete: async (path: string) => void calls.push(`delete ${path}`)
        };
        const server = spawner.processes[0].server;
        return { ...result, server, calls, written, file };
    }

    const importEdits = () => ({ documentChanges: [line(join(WORK, 'src/a.ts'), './c'), line(join(WORK, 'src/b.ts'), './c')] });

    it('makes what a server would change before the move, in the open editor and in the file nobody has open, and tells it afterwards', async () => {
        const { host, server, calls, written, file, events } = await moveRig(importEdits);
        const moving = host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file);
        await until(host, () => kinds(events['client-1'], 'language.edit').length > 0);
        const [asked] = kinds(events['client-1'], 'language.edit');
        const { editId, edit } = (asked as { payload: { editId: string; edit: { documentChanges: Array<{ textDocument: { uri: string } }> } } }).payload;
        expect(edit.documentChanges.map((change) => change.textDocument.uri)).toEqual([uri('src/a.ts')]);
        expect(calls).toEqual([]);
        host.answerEdit('client-1', { projectId: 'p1', editId, applied: true });
        expect(await moving).toEqual([join(WORK, 'src/a.ts'), join(WORK, 'src/b.ts')]);
        expect(calls).toEqual(['write', 'move']);
        expect(written).toEqual([{ path: join(WORK, 'src/b.ts'), text: 'import "./c";\n' }]);
        expect(server.paramsOf('workspace/willRenameFiles')).toEqual([{ files: [{ oldUri: uri('src/a.ts'), newUri: uri('src/c.ts') }] }]);
        expect(server.paramsOf('workspace/didRenameFiles')).toEqual([{ files: [{ oldUri: uri('src/a.ts'), newUri: uri('src/c.ts') }] }]);
    });

    it('makes a file the server creates first, with the text the edit writes into it', async () => {
        const index = uri('src/index.ts');
        const { host, calls, written, file } = await moveRig(() => ({
            documentChanges: [
                { kind: 'create', uri: index, options: { overwrite: false, ignoreIfExists: false } },
                {
                    textDocument: { uri: index, version: null },
                    edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'export * from "./c";\n' }]
                },
                line(join(WORK, 'src/b.ts'), './c')
            ]
        }));
        expect(await host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file)).toEqual([join(WORK, 'src/index.ts'), join(WORK, 'src/b.ts')]);
        expect(calls).toEqual(['create', 'write', 'move']);
        expect(written).toEqual([
            { path: join(WORK, 'src/index.ts'), text: 'export * from "./c";\n' },
            { path: join(WORK, 'src/b.ts'), text: 'import "./c";\n' }
        ]);
    });

    it('moves anyway, without the edit, when the server creates a file that is there', async () => {
        const { host, calls, file } = await moveRig(() => ({
            documentChanges: [{ kind: 'create', uri: uri('src/b.ts') }, line(join(WORK, 'src/b.ts'), './c')]
        }));
        expect(await host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file)).toEqual([]);
        expect(calls).toEqual(['move']);
    });

    it('sends the edit of an open document to the client that asked, and only the files it holds', async () => {
        const { host, calls, file, events } = await moveRig(importEdits);
        await open(host, 'src/a.ts', 'export "./a";\n', 'client-2');
        const unsubscribe = host.subscribe('client-2', (event) => {
            events['client-2'].push(event);
            if (event.event === 'language.edit') {
                host.answerEdit('client-2', { projectId: 'p1', editId: editIdOf(event), applied: true });
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
        const asked = Promise.withResolvers<void>();
        const { host, calls, file, clock, server } = await moveRig(() => {
            asked.resolve();
            return new Promise(() => undefined);
        });
        const moving = host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file);
        await asked.promise;
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
        await host.renameFiles('client-1', 'p1', join(WORK, 'notes.md'), join(WORK, 'todo.md'), true, file);
        expect(server.paramsOf('workspace/willRenameFiles')).toEqual([]);
        expect(server.paramsOf('workspace/didRenameFiles')).toHaveLength(1);
        expect(calls).toEqual(['move', 'move']);
    });

    it('moves anyway, and skips the whole edit, when the server deletes a file that is not there', async () => {
        const { host, calls, written, file, events, server } = await moveRig(() => ({
            documentChanges: [line(join(WORK, 'src/b.ts'), './c'), { kind: 'delete', uri: uri('src/old.ts') }]
        }));
        expect(await host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file)).toEqual([]);
        expect(calls).toEqual(['move']);
        expect(written).toEqual([]);
        expect(kinds(events['client-1'], 'language.edit')).toHaveLength(0);
        expect(server.paramsOf('workspace/didRenameFiles')).toHaveLength(1);
        expect((await host.log('p1', 'typescript')).map((entry) => entry.text).join('\n')).toContain('left out the edit of a rename');
    });

    it('carries out the moves, creates and deletes of a server edit in order, and edits a moved file where it now stands', async () => {
        const { host, calls, written, file } = await moveRig(
            () => ({
                documentChanges: [
                    { kind: 'rename', oldUri: uri('src/b.ts'), newUri: uri('src/d.ts') },
                    line(join(WORK, 'src/d.ts'), './c'),
                    { kind: 'delete', uri: uri('src/old.ts') },
                    { kind: 'create', uri: uri('src/index.ts') },
                    {
                        textDocument: { uri: uri('src/index.ts'), version: null },
                        edits: [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: 'export {};\n' }]
                    }
                ]
            }),
            { [join(WORK, 'src/old.ts')]: 'old\n' }
        );
        expect(await host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file)).toEqual([join(WORK, 'src/d.ts'), join(WORK, 'src/index.ts')]);
        expect(calls).toEqual([`rename ${join(WORK, 'src/b.ts')} ${join(WORK, 'src/d.ts')}`, 'write', `delete ${join(WORK, 'src/old.ts')}`, 'create', 'move']);
        expect(written).toEqual([
            { path: join(WORK, 'src/d.ts'), text: 'import "./c";\n' },
            { path: join(WORK, 'src/index.ts'), text: 'export {};\n' }
        ]);
    });

    const held = uri('src/a.ts');
    const refusedPlans: Record<string, Array<Record<string, unknown>>> = {
        'a rename of a held file': [{ kind: 'rename', oldUri: held, newUri: uri('src/d.ts') }],
        'a rename onto a held file': [{ kind: 'rename', oldUri: uri('src/b.ts'), newUri: held, options: { overwrite: true } }],
        'an overwriting create of a held file': [{ kind: 'create', uri: held, options: { overwrite: true } }],
        'a delete of a held file': [{ kind: 'delete', uri: held }]
    };
    const folderPlans: Record<string, Array<Record<string, unknown>>> = {
        'a rename of a folder that holds a file': [{ kind: 'rename', oldUri: uri('src'), newUri: uri('lib') }],
        'a delete of a folder that holds a file': [{ kind: 'delete', uri: uri('src'), options: { recursive: true } }]
    };

    for (const [name, steps] of Object.entries(refusedPlans)) {
        it(`refuses ${name} and changes nothing`, async () => {
            const rig = await moveRig(() => ({ documentChanges: [{ kind: 'create', uri: uri('src/e.ts') }, ...steps] }));
            await expect(rig.host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, rig.file)).rejects.toMatchObject({
                code: LANGUAGE_ERROR_CODES.failed
            });
            expect(rig.calls).toEqual([]);
            expect(kinds(rig.events['client-1'], 'language.edit')).toHaveLength(0);
        });
    }

    for (const [name, steps] of Object.entries(folderPlans)) {
        it(`refuses ${name} and changes nothing`, async () => {
            const rig = await moveRig(() => ({ documentChanges: [{ kind: 'create', uri: uri('e.ts') }, ...steps] }), {}, [join(WORK, 'src')]);
            await expect(rig.host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, rig.file)).rejects.toMatchObject({
                code: LANGUAGE_ERROR_CODES.failed
            });
            expect(rig.calls).toEqual([]);
        });
    }

    it('leaves the disk as it was when the editor refuses the edit of a plan that also moves a closed file', async () => {
        const rig = await moveRig(() => ({
            documentChanges: [{ kind: 'rename', oldUri: uri('src/b.ts'), newUri: uri('src/d.ts') }, line(join(WORK, 'src/a.ts'), './c')]
        }));
        const moving = rig.host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, rig.file);
        const outcome = moving.then(
            () => 'moved',
            (error: { message: string }) => error.message
        );
        await until(rig.host, () => kinds(rig.events['client-1'], 'language.edit').length > 0);
        const [asked] = kinds(rig.events['client-1'], 'language.edit');
        rig.host.answerEdit('client-1', {
            projectId: 'p1',
            editId: editIdOf(asked),
            applied: false,
            failureReason: 'Version in flight'
        });
        expect(await outcome).toBe('Version in flight');
        expect(rig.calls).toEqual([]);
    });

    it('edits the held documents first, then moves and writes the closed files', async () => {
        const rig = await moveRig(() => ({
            documentChanges: [
                { kind: 'rename', oldUri: uri('src/b.ts'), newUri: uri('src/d.ts') },
                line(join(WORK, 'src/d.ts'), './c'),
                line(join(WORK, 'src/a.ts'), './c')
            ]
        }));
        const moving = rig.host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, rig.file);
        await until(rig.host, () => kinds(rig.events['client-1'], 'language.edit').length > 0);
        expect(rig.calls).toEqual([]);
        const [asked] = kinds(rig.events['client-1'], 'language.edit');
        rig.host.answerEdit('client-1', { projectId: 'p1', editId: editIdOf(asked), applied: true });
        expect(await moving).toEqual([join(WORK, 'src/d.ts'), join(WORK, 'src/a.ts')]);
        expect(rig.calls).toEqual([`rename ${join(WORK, 'src/b.ts')} ${join(WORK, 'src/d.ts')}`, 'write', 'move']);
        expect(rig.written).toEqual([{ path: join(WORK, 'src/d.ts'), text: 'import "./c";\n' }]);
    });

    it('checks the version of a held document against the daemon, and leaves a stale edit out', async () => {
        const stale = (version: number) => ({
            documentChanges: [{ textDocument: { uri: uri('src/a.ts'), version }, edits: line(join(WORK, 'src/a.ts'), './c').edits }]
        });
        const fresh = await moveRig(() => stale(1));
        const document = [...fresh.host['projects'].get('p1')!.documents.values()][0]!;
        const moving = fresh.host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, fresh.file);
        await until(fresh.host, () => kinds(fresh.events['client-1'], 'language.edit').length > 0);
        const [asked] = kinds(fresh.events['client-1'], 'language.edit');
        const payload = (asked as { payload: { editId: string; edit: { documentChanges: Array<{ textDocument: { version: number } }> } } }).payload;
        expect(payload.edit.documentChanges[0]!.textDocument.version).toBe(document.version);
        fresh.host.answerEdit('client-1', { projectId: 'p1', editId: payload.editId, applied: true });
        expect(await moving).toEqual([join(WORK, 'src/a.ts')]);

        const old = await moveRig(() => stale(99));
        expect(await old.host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, old.file)).toEqual([]);
        expect(old.calls).toEqual(['move']);
        expect(kinds(old.events['client-1'], 'language.edit')).toHaveLength(0);
        expect((await old.host.log('p1', 'typescript')).map((entry) => entry.text).join('\n')).toContain('Workspace edit version mismatch');
    });

    it('moves anyway, and skips the edit, when it does not fit the text', async () => {
        const unfit = await moveRig(() => ({
            documentChanges: [
                { ...line(join(WORK, 'src/b.ts'), 'c'), edits: [{ range: { start: { line: 9, character: 0 }, end: { line: 9, character: 1 } }, newText: 'x' }] }
            ]
        }));
        expect(await unfit.host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, unfit.file)).toEqual([]);
        expect(unfit.calls).toEqual(['move']);
        expect((await unfit.host.log('p1', 'typescript')).map((entry) => entry.text).join('\n')).toContain('left out the edit of a rename');
    });

    it('does not move when the editor refuses the edit', async () => {
        const { host, calls, file, events } = await moveRig(importEdits);
        const moving = host.renameFiles('client-1', 'p1', aToC.from, aToC.to, true, file);
        const outcome = moving.then(
            () => 'moved',
            (error: { message: string }) => error.message
        );
        await until(host, () => kinds(events['client-1'], 'language.edit').length > 0);
        const [asked] = kinds(events['client-1'], 'language.edit');
        host.answerEdit('client-1', {
            projectId: 'p1',
            editId: editIdOf(asked),
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

describe('files that are made or deleted', () => {
    const files = [{ scheme: 'file', pattern: { glob: '**/*.ts', matches: 'file' as const } }];
    const folders = [{ scheme: 'file', pattern: { glob: '**/gen', matches: 'folder' as const } }];
    const operations = {
        willCreate: { filters: files },
        didCreate: { filters: files },
        willDelete: { filters: files },
        didDelete: { filters: [...files, ...folders] }
    };
    const capabilities = { typescript: { ...FULL_CAPABILITIES, workspace: { fileOperations: operations } } };
    const created = uri('src/new.ts');
    const barrel = (text: string) => ({
        documentChanges: [
            {
                textDocument: { uri: uri('src/b.ts'), version: null },
                edits: [{ range: { start: { line: 0, character: 8 }, end: { line: 0, character: 11 } }, newText: text }]
            }
        ]
    });

    async function rig(handlers: Record<string, (params: unknown) => unknown> = {}) {
        const spawner = fakeSpawner(capabilities, [], { typescript: handlers });
        const result = await installed(['typescript'], { spawner, texts: { [join(WORK, 'src/b.ts')]: 'import "./a";\n' } });
        await openReady(result.host, 'src/a.ts', 'export "./a";\n');
        const calls: string[] = [];
        const written: Array<{ path: string; text: string }> = [];
        const file = {
            move: async () => void calls.push('run'),
            write: async (path: string, text: string) => {
                calls.push('write');
                written.push({ path, text });
            },
            create: async () => void calls.push('create'),
            rename: async () => void calls.push('rename'),
            delete: async () => void calls.push('delete')
        };
        return { ...result, server: spawner.processes[0].server, calls, written, file };
    }

    it('asks what a new file changes before it is made, applies the edit, and tells the server afterwards', async () => {
        const { host, server, calls, written, file } = await rig({ 'workspace/willCreateFiles': () => barrel('./new') });
        expect(await host.createFiles('client-1', 'p1', join(WORK, 'src/new.ts'), false, true, file)).toEqual([join(WORK, 'src/b.ts')]);
        expect(calls).toEqual(['write', 'run']);
        expect(written).toEqual([{ path: join(WORK, 'src/b.ts'), text: 'import "./new";\n' }]);
        expect(server.paramsOf('workspace/willCreateFiles')).toEqual([{ files: [{ uri: created }] }]);
        expect(server.paramsOf('workspace/didCreateFiles')).toEqual([{ files: [{ uri: created }] }]);
    });

    it('asks what a delete changes while the file is still there, and tells the server afterwards', async () => {
        const { host, server, calls, file } = await rig({ 'workspace/willDeleteFiles': () => barrel('./gone') });
        expect(await host.deleteFiles('client-1', 'p1', join(WORK, 'src/b.ts'), true, file)).toEqual([join(WORK, 'src/b.ts')]);
        expect(calls).toEqual(['write', 'run']);
        expect(server.paramsOf('workspace/willDeleteFiles')).toEqual([{ files: [{ uri: uri('src/b.ts') }] }]);
        expect(server.paramsOf('workspace/didDeleteFiles')).toEqual([{ files: [{ uri: uri('src/b.ts') }] }]);
    });

    it('matches a folder as a folder', async () => {
        const { host, server, file } = await rig();
        const folder = join(root, 'src/gen');
        const folderUri = pathToFileUri(folder);
        await host.createFiles('client-1', 'p1', folder, true, true, { ...file, move: () => mkdir(folder, { recursive: true }).then(() => undefined) });
        await host.deleteFiles('client-1', 'p1', folder, true, { ...file, move: () => rm(folder, { recursive: true }) });
        expect(server.paramsOf('workspace/didCreateFiles')).toEqual([]);
        expect(server.paramsOf('workspace/willDeleteFiles')).toEqual([]);
        expect(server.paramsOf('workspace/didDeleteFiles')).toEqual([{ files: [{ uri: folderUri }] }]);
    });

    it('only tells the servers when the caller made the edits itself', async () => {
        const { host, server, calls, file } = await rig({ 'workspace/willCreateFiles': () => barrel('./new') });
        await host.createFiles('client-1', 'p1', join(WORK, 'src/new.ts'), false, false, file);
        expect(server.paramsOf('workspace/willCreateFiles')).toEqual([]);
        expect(server.paramsOf('workspace/didCreateFiles')).toHaveLength(1);
        expect(calls).toEqual(['run']);
    });

    it('goes on, without the edit, when a server fails or its edit does not fit', async () => {
        const failing = await rig({
            'workspace/willCreateFiles': () => {
                throw new Error('boom');
            }
        });
        expect(await failing.host.createFiles('client-1', 'p1', join(WORK, 'src/new.ts'), false, true, failing.file)).toEqual([]);
        expect(failing.calls).toEqual(['run']);
        const unfit = await rig({ 'workspace/willDeleteFiles': () => ({ documentChanges: [{ kind: 'delete', uri: uri('src/old.ts') }] }) });
        expect(await unfit.host.deleteFiles('client-1', 'p1', join(WORK, 'src/b.ts'), true, unfit.file)).toEqual([]);
        expect(unfit.calls).toEqual(['run']);
        expect((await unfit.host.log('p1', 'typescript')).map((entry) => entry.text).join('\n')).toContain('left out the edit of a delete');
    });

    it('only runs the operation when no server of the project is up', async () => {
        const { host, calls, file } = await rig();
        expect(await host.deleteFiles('client-1', 'other', join(WORK, 'src/b.ts'), true, file)).toEqual([]);
        expect(calls).toEqual(['run']);
    });
});

describe('format on type', () => {
    const edits = [{ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, newText: ' ' }];
    const capabilities = {
        typescript: { ...FULL_CAPABILITIES, documentOnTypeFormattingProvider: { firstTriggerCharacter: '}', moreTriggerCharacter: [';'] } }
    };

    it('offers the trigger characters and routes the request to the server', async () => {
        const spawner = fakeSpawner(capabilities, [], { typescript: { 'textDocument/onTypeFormatting': () => edits } });
        const { host, events } = await installed(['typescript'], { spawner });
        await openReady(host);
        const [providers] = kinds(events['client-1'], 'language.providers');
        expect((providers as { payload: { providers: Record<string, unknown> } }).payload.providers['textDocument/onTypeFormatting']).toEqual({
            firstTriggerCharacter: '}',
            moreTriggerCharacter: [';']
        });
        const params = { position: { line: 0, character: 1 }, ch: '}', options: { tabSize: 4, insertSpaces: true } };
        const answer = await host.request({ projectId: 'p1', path: 'src/a.ts', method: 'textDocument/onTypeFormatting', params });
        expect(answer.result).toEqual(edits);
        expect(spawner.processes[0].server.paramsOf('textDocument/onTypeFormatting')).toEqual([{ textDocument: { uri: uri('src/a.ts') }, ...params }]);
    });
});

describe('an agent asking about a file', () => {
    const hover = { contents: { kind: 'markdown', value: '`let a: number`' } };

    it('opens a file nobody holds with the text on disk, answers from it, and lets it go', async () => {
        const spawner = fakeSpawner({}, [], { typescript: { 'textDocument/hover': () => hover } });
        const { host } = await installed(['typescript'], { spawner });
        const answer = await host.forAgent(
            'p1',
            { path: join(WORK, 'src/a.ts'), languageId: 'typescript', disk: 'let a = 1;\n', owner: 'agent:chat-1' },
            async (document) => {
                expect(document).toMatchObject({
                    storedPath: 'src/a.ts',
                    text: 'let a = 1;\n',
                    unsaved: false,
                    servers: [{ kind: 'typescript', state: 'ready' }]
                });
                return document.request('textDocument/hover', { position: { line: 0, character: 4 } });
            }
        );
        expect(answer.result).toEqual(hover);
        await settle();
        const [process] = spawner.of('typescript');
        expect(process!.server.paramsOf('textDocument/didClose')).toHaveLength(1);
        await expect(host.request({ projectId: 'p1', path: 'src/a.ts', method: 'textDocument/hover', params: {} })).rejects.toMatchObject({
            code: LANGUAGE_ERROR_CODES.documentNotOpen
        });
    });

    it('joins a document a person has open and keeps the text in their editor', async () => {
        const { host, spawner } = await installed(['typescript']);
        await openReady(host, 'src/a.ts', 'let edited = 2;\n');
        await host.forAgent('p1', { path: join(WORK, 'src/a.ts'), languageId: 'typescript', disk: 'let a = 1;\n', owner: 'agent:chat-1' }, async (document) => {
            expect(document.text).toBe('let edited = 2;\n');
            expect(document.unsaved).toBe(true);
        });
        await settle();
        const [process] = spawner.of('typescript');
        expect(process!.server.paramsOf('textDocument/didClose')).toEqual([]);
        expect([...process!.server.documents.values()].map((document) => document.text)).toEqual(['let edited = 2;\n']);
    });

    it('waits for the first report of a server that pushes what it finds', async () => {
        const { host, spawner } = await installed(['yaml']);
        const asked = host.forAgent('p1', { path: join(WORK, 'a.yaml'), languageId: 'yaml', disk: 'a: [', owner: 'agent:chat-1' }, (document) =>
            document.diagnostics()
        );
        await ready(host, 'yaml');
        const [process] = spawner.of('yaml');
        await process!.server.publishDiagnostics(uri('a.yaml'), [
            { range: { start: { line: 0, character: 3 }, end: { line: 0, character: 4 } }, message: 'Unclosed' }
        ]);
        expect(await asked).toEqual([{ server: 'yaml', diagnostics: [expect.objectContaining({ message: 'Unclosed' })] }]);
    });

    it('never installs a server: one that is not installed says so', async () => {
        const { host, installs } = rig();
        const servers = await host.forAgent(
            'p1',
            { path: join(WORK, 'src/a.ts'), languageId: 'typescript', disk: '', owner: 'agent:chat-1' },
            async (document) => document.servers
        );
        expect(servers).toEqual([{ kind: 'typescript', state: 'not-installed' }]);
        expect(installs).toEqual([]);
    });

    it("reads no file under the machine's own state", async () => {
        const { host } = await installed(['typescript']);
        await expect(
            host.forAgent('p1', { path: '/home/.ruimte/secret.ts', languageId: 'typescript', disk: '', owner: 'agent:chat-1' }, async () => undefined)
        ).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.badPath });
    });
});

describe('the SQL of a project', () => {
    it('tells a running PHP server new settings when the SQL of the project changes, and starts the next one with them', async () => {
        let settings: ProjectSqlSettings = { sql: {}, php: { dialect: 'mysql' }, unbound: [] };
        const { host, spawner } = await installed(['php-native'], { sqlSettings: async () => settings });
        await open(host, 'src/a.php', '<?php', 'client-1', 'php');
        await ready(host, 'php-native');
        const [process] = spawner.of('php-native');
        expect(process!.server.paramsOf('initialize')[0]).toMatchObject({ initializationOptions: { sql: { dialect: 'mysql' } } });
        settings = { sql: {}, php: { dialect: 'mariadb', schema: '/snap.json' }, unbound: [] };
        await host.sqlChanged('p1');
        await settle();
        expect(process!.server.paramsOf('workspace/didChangeConfiguration').at(-1)).toEqual({
            settings: { phpLanguageServer: { sql: { dialect: 'mariadb', schema: '/snap.json' } } }
        });
        await host.restart('p1', 'php-native');
        await ready(host, 'php-native');
        const next = spawner.of('php-native');
        expect(next).toHaveLength(2);
        expect(next[1]!.server.paramsOf('initialize')[0]).toMatchObject({
            initializationOptions: { sql: { dialect: 'mariadb', schema: '/snap.json' } }
        });
    });

    it('hands a snapshot written outside the project to the servers that watch it', async () => {
        const { host, spawner } = await installed(['php-native'], { sqlSettings: async () => ({ sql: {}, php: {}, unbound: [] }) });
        await open(host, 'src/a.php', '<?php', 'client-1', 'php');
        await ready(host, 'php-native');
        const [process] = spawner.of('php-native');
        await process!.server.request('client/registerCapability', {
            registrations: [
                { id: 'php-sql-snapshots', method: 'workspace/didChangeWatchedFiles', registerOptions: { watchers: [{ globPattern: '/snapshots/shop.json' }] } }
            ]
        });
        await host.outsideFilesChanged([
            { path: '/snapshots/shop.json', type: 2 },
            { path: '/snapshots/other.json', type: 2 }
        ]);
        await settle();
        expect(process!.server.paramsOf('workspace/didChangeWatchedFiles')).toEqual([{ changes: [{ uri: 'file:///snapshots/shop.json', type: 2 }] }]);
    });
});

describe('what a server says to a person', () => {
    async function talking() {
        const result = await installed();
        await openReady(result.host);
        const { server } = result.spawner.processes[0]!;

        return { ...result, server };
    }

    function messages(events: SessionEvent[]) {
        return kinds(events, 'language.message').map(
            (event) => (event as { payload: { messageId: string; type: number; message: string; actions?: string[] } }).payload
        );
    }

    it('toasts an error and a warning to the holders, and keeps an info and a log in the log', async () => {
        const { host, server, events } = await talking();

        await server.notify('window/showMessage', { type: 1, message: 'broken' });
        await server.notify('window/showMessage', { type: 2, message: 'careful' });
        await server.notify('window/showMessage', { type: 3, message: 'fyi' });
        await server.notify('window/showMessage', { type: 4, message: 'chatter' });
        await settle();

        expect(messages(events['client-1']).map((message) => [message.type, message.message, message.actions])).toEqual([
            [1, 'broken', undefined],
            [2, 'careful', undefined]
        ]);
        expect(messages(events['client-2'])).toEqual([]);
        expect((await host.log('p1', 'typescript')).filter((line) => line.source === 'message').map((line) => [line.text, line.level])).toEqual([
            ['broken', 'error'],
            ['careful', 'warning'],
            ['fyi', 'info'],
            ['chatter', 'log']
        ]);
    });

    it('waits for the first answer to a message request, ignores the second and tells the holders it closed', async () => {
        const { host, server, events } = await talking();
        const asked = server.request('window/showMessageRequest', { type: 3, message: 'Update?', actions: [{ title: 'Yes', id: 1 }, { title: 'No' }] });
        await settle();
        const [message] = messages(events['client-1']);

        expect(message).toMatchObject({ type: 3, message: 'Update?', actions: ['Yes', 'No'] });

        host.answerMessage({ projectId: 'p1', messageId: message!.messageId, action: 'Yes' });
        host.answerMessage({ projectId: 'p1', messageId: message!.messageId, action: 'No' });

        expect(await asked).toEqual({ title: 'Yes', id: 1 });
        expect(kinds(events['client-1'], 'language.messageClosed')).toMatchObject([{ payload: { projectId: 'p1', messageId: message!.messageId } }]);
    });

    it('answers null to a dismissed request, to an action it does not list, and at once when nobody holds the project', async () => {
        const { host, server, events, holders } = await talking();
        const dismissed = server.request('window/showMessageRequest', { type: 2, message: 'Sure?', actions: [{ title: 'Yes' }] });
        await settle();
        host.answerMessage({ projectId: 'p1', messageId: messages(events['client-1'])[0]!.messageId, action: null });

        expect(await dismissed).toBeNull();

        const unknown = server.request('window/showMessageRequest', { type: 2, message: 'Again?', actions: [{ title: 'Yes' }] });
        await settle();
        host.answerMessage({ projectId: 'p1', messageId: messages(events['client-1'])[1]!.messageId, action: 'Maybe' });

        expect(await unknown).toBeNull();

        holders.clear();

        expect(await server.request('window/showMessageRequest', { type: 2, message: 'Alone?', actions: [{ title: 'Yes' }] })).toBeNull();
        expect(messages(events['client-1'])).toHaveLength(2);
    });

    it('settles a request when its server goes down, so the prompt closes', async () => {
        const { server, spawner, events } = await talking();
        // The connection dies with the process, so the server's own side of the request fails.
        const asked = server.request('window/showMessageRequest', { type: 2, message: 'Sure?', actions: [{ title: 'Yes' }] }).catch(() => undefined);
        await settle();

        expect(kinds(events['client-1'], 'language.messageClosed')).toHaveLength(0);

        await spawner.processes[0]!.crash();
        await asked;
        await settle();

        expect(kinds(events['client-1'], 'language.messageClosed')).toHaveLength(1);
    });

    it('settles a request with null when the last holder of the project leaves', async () => {
        const { host, server, holders } = await talking();
        holders.clear();
        holders.add('client-3');
        const leave = host.subscribe('client-3', () => undefined);
        const asked = server.request('window/showMessageRequest', { type: 2, message: 'Sure?', actions: [{ title: 'Yes' }] });
        await settle();
        holders.clear();
        leave();

        expect(await asked).toBeNull();
    });

    describe('showing a document', () => {
        async function showing(uriToShow: string, clientId = 'client-1', external?: boolean) {
            const result = await talking();
            result.server.handle('workspace/executeCommand', () =>
                result.server.request('window/showDocument', { uri: uriToShow, selection: range, ...(external === undefined ? {} : { external }) })
            );
            const answer = (await result.host.command(clientId, { projectId: 'p1', path: 'src/a.ts', command: 'show' })).result;

            return { ...result, answer };
        }

        const range = { start: { line: 2, character: 0 }, end: { line: 2, character: 4 } };
        const shownTo = (events: SessionEvent[]) => kinds(events, 'language.show').map((event) => event.payload);

        it('refuses without a running command, and says so in the log', async () => {
            const { host, server, events } = await talking();

            expect(await server.request<{ success: boolean }>('window/showDocument', { uri: uri('src/b.ts') })).toEqual({ success: false });
            expect(shownTo(events['client-1'])).toEqual([]);
            expect((await host.log('p1', 'typescript')).some((line) => line.text.includes('asked to show') && line.text.includes('no command'))).toBe(true);
        });

        it('opens a file of the project in the client whose command runs, and in no other', async () => {
            const { answer, events } = await showing(uri('src/b.ts'), 'client-2');

            expect(answer).toEqual({ success: true });
            expect(shownTo(events['client-2'])).toEqual([{ projectId: 'p1', server: 'typescript', title: 'typescript', path: 'src/b.ts', selection: range }]);
            expect(shownTo(events['client-1'])).toEqual([]);
        });

        it('refuses a file outside the project and a file that asks for an outside application', async () => {
            const outside = await showing(pathToFileUri(resolve('/elsewhere/x.ts')));
            const external = await showing(uri('src/b.ts'), 'client-1', true);

            expect(outside.answer).toEqual({ success: false });
            expect(external.answer).toEqual({ success: false });
            expect(shownTo(outside.events['client-1'])).toEqual([]);
            expect(shownTo(external.events['client-1'])).toEqual([]);
        });

        it('offers a web address with the answer no, since nothing was shown yet', async () => {
            const { answer, events } = await showing('https://ruimte.app/docs');

            expect(answer).toEqual({ success: false });
            expect(shownTo(events['client-1'])).toEqual([{ projectId: 'p1', server: 'typescript', title: 'typescript', url: 'https://ruimte.app/docs' }]);
        });

        it('refuses mailto and anything that is no address', async () => {
            for (const refused of ['mailto:bas@example.com', 'vscode://file/x', 'not an address']) {
                const { answer, events } = await showing(refused);

                expect(answer).toEqual({ success: false });
                expect(shownTo(events['client-1'])).toEqual([]);
            }
        });
    });

    describe('trace', () => {
        it('switches the trace of a running server and says so in its status', async () => {
            const { host, spawner } = await talking();

            expect((await host.trace('p1', 'typescript', 'messages')).trace).toBe('messages');
            expect(spawner.processes[0]!.server.paramsOf('$/setTrace')).toEqual([{ value: 'messages' }]);
            expect((await host.trace('p1', 'typescript', 'off')).trace).toBeUndefined();
        });

        it('refuses a server that does not run in the project', async () => {
            const { host } = await talking();

            await expect(host.trace('p1', 'css', 'verbose')).rejects.toMatchObject({ code: LANGUAGE_ERROR_CODES.unavailable });
        });
    });
});

describe('the problems of the whole project', () => {
    const pulling = { textDocumentSync: 2 as const, diagnosticProvider: { interFileDependencies: true, workspaceDiagnostics: true } };
    const problem = (message: string) => ({ range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message });

    async function pull() {
        const spawner = fakeSpawner({ typescript: pulling });
        const result = await installed(['typescript'], { spawner });
        await openReady(result.host);

        return { ...result, fake: spawner.processes[0]!.server };
    }

    const reportsOf = (events: SessionEvent[]) =>
        kinds(events, 'language.diagnostics').map(
            (event) => (event as { payload: { projectId: string; path: string; server: string; diagnostics: unknown[]; version?: number } }).payload
        );

    it('sends a full report to the holders under the stored path and without a version, and counts the files', async () => {
        const { host, fake, events } = await pull();
        fake.handle('workspace/diagnostic', () => ({
            items: [
                { kind: 'full', uri: uri('src/b.ts'), version: null, resultId: 'r1', items: [problem('bad')] },
                { kind: 'full', uri: uri('src/c.ts'), version: null, items: [] }
            ]
        }));

        const answer = await host.workspaceProblems('client-2', 'p1');

        expect(answer).toMatchObject({ servers: ['typescript'], files: 2 });
        expect(answer.reports.map((report) => [report.path, report.server])).toEqual([['src/b.ts', 'typescript']]);
        expect(reportsOf(events['client-1']).filter((report) => report.path === 'src/b.ts')).toEqual([
            { projectId: 'p1', path: 'src/b.ts', server: 'typescript', diagnostics: [problem('bad')] }
        ]);
        expect(reportsOf(events['client-2'])).toEqual([]);
    });

    it('reads the cached reports without asking the server, and says whether a pull ran', async () => {
        const { host, fake } = await pull();
        fake.handle('workspace/diagnostic', () => ({ items: [{ kind: 'full', uri: uri('src/b.ts'), version: null, items: [problem('bad')] }] }));

        expect(host.cachedWorkspaceProblems('p1')).toMatchObject({ servers: ['typescript'], pulled: false, reports: [] });
        expect(fake.paramsOf('workspace/diagnostic')).toEqual([]);

        await host.workspaceProblems(null, 'p1');
        const cached = host.cachedWorkspaceProblems('p1');

        expect(cached.pulled).toBe(true);
        expect(cached.reports.map((report) => report.path)).toEqual(['src/b.ts']);
        expect(fake.paramsOf('workspace/diagnostic')).toHaveLength(1);
    });

    it('takes the reports streamed while the server works, and asks for what changed with the result ids it heard', async () => {
        const { host, fake, events } = await pull();
        fake.handle('workspace/diagnostic', async (params) => {
            const { partialResultToken } = params as { partialResultToken: string };
            await fake.notify('$/progress', {
                token: partialResultToken,
                value: { items: [{ kind: 'full', uri: uri('src/b.ts'), version: null, resultId: 'r1', items: [problem('bad')] }] }
            });

            return { items: [] };
        });

        await host.workspaceProblems(null, 'p1');
        await host.workspaceProblems(null, 'p1');

        expect(reportsOf(events['client-1']).filter((report) => report.path === 'src/b.ts')).toHaveLength(2);
        expect((fake.paramsOf('workspace/diagnostic')[1] as { previousResultIds: unknown }).previousResultIds).toEqual([{ uri: uri('src/b.ts'), value: 'r1' }]);
    });

    it('sends a report the server found unchanged again to the asking client only', async () => {
        const { host, fake, events } = await pull();
        let items: unknown[] = [{ kind: 'full', uri: uri('src/b.ts'), version: null, resultId: 'r1', items: [problem('bad')] }];
        fake.handle('workspace/diagnostic', () => ({ items }));
        await host.workspaceProblems(null, 'p1');
        items = [{ kind: 'unchanged', uri: uri('src/b.ts'), version: null, resultId: 'r1' }];
        const before = reportsOf(events['client-1']).length;

        const answer = await host.workspaceProblems('client-2', 'p1');

        expect(reportsOf(events['client-1'])).toHaveLength(before);
        expect(reportsOf(events['client-2'])).toEqual([{ projectId: 'p1', path: 'src/b.ts', server: 'typescript', diagnostics: [problem('bad')] }]);
        expect(answer).toMatchObject({ files: 0, reports: [{ path: 'src/b.ts' }] });
    });

    it('skips a file the server has open as a document', async () => {
        const { host, fake, events } = await pull();
        fake.handle('workspace/diagnostic', () => ({
            items: [{ kind: 'full', uri: uri('src/a.ts'), version: null, resultId: 'r1', items: [problem('bad')] }]
        }));
        const before = reportsOf(events['client-1']).length;

        const answer = await host.workspaceProblems(null, 'p1');

        expect(answer).toMatchObject({ files: 0, reports: [] });
        expect(reportsOf(events['client-1'])).toHaveLength(before);
    });

    it('asks a process once when two callers pull at the same time, and both hear the files', async () => {
        const { host, fake } = await pull();
        const release = Promise.withResolvers<void>();
        fake.handle('workspace/diagnostic', async () => {
            await release.promise;

            return { items: [{ kind: 'full', uri: uri('src/b.ts'), version: null, resultId: 'r1', items: [problem('bad')] }] };
        });

        const first = host.workspaceProblems('client-1', 'p1');
        const second = host.workspaceProblems('client-2', 'p1');
        await settle();
        release.resolve();

        expect((await first).files).toBe(1);
        expect((await second).files).toBe(1);
        expect(fake.paramsOf('workspace/diagnostic')).toHaveLength(1);
    });

    it('asks no server that does not offer workspace diagnostics', async () => {
        const { host } = await installed();
        await openReady(host);

        expect(await host.workspaceProblems(null, 'p1')).toEqual({ servers: [], files: 0, reports: [] });
    });

    it('takes back what the pull reported when the server crashes', async () => {
        const { host, fake, events, spawner } = await pull();
        fake.handle('workspace/diagnostic', () => ({
            items: [{ kind: 'full', uri: uri('src/b.ts'), version: null, resultId: 'r1', items: [problem('bad')] }]
        }));
        await host.workspaceProblems(null, 'p1');

        await spawner.processes[0]!.crash();
        await settle();

        expect(
            reportsOf(events['client-1'])
                .filter((report) => report.path === 'src/b.ts')
                .at(-1)
        ).toMatchObject({ diagnostics: [] });
    });
});
