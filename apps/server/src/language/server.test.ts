import { describe, expect, it } from 'bun:test';
import { LanguageServer, type LanguageServerHooks, type SharedDocument } from './server.ts';
import { KIND_PROFILES } from './profiles.ts';
import { fakeSpawner, ManualClock, settle, type FakeSpawner } from './test-fakes.ts';
import type { LanguageServerKind } from '@ruimte/contracts';
import type { Diagnostic, PublishDiagnosticsParams, ServerCapabilities } from '@ruimte/smart-editor-lsp';

const runtime = { command: '/ruimte', args: [], env: { BUN_BE_BUN: '1' } };

function document(path: string, languageId: string, text: string): SharedDocument {
    return {
        absolutePath: path,
        uri: `file://${path}`,
        kinds: [],
        storedPath: path.replace('/work/', ''),
        languageId,
        text,
        version: 1,
        clients: new Set(['client-1'])
    };
}

interface Rig {
    server: LanguageServer;
    spawner: FakeSpawner;
    clock: ManualClock;
    states: string[];
    diagnostics: { path: string; component: string; params: PublishDiagnosticsParams }[];
    providers: string[];
    install: { installed: boolean };
}

function rig(kind: LanguageServerKind, spawner = fakeSpawner()): Rig {
    const clock = new ManualClock();
    const states: string[] = [];
    const diagnostics: Rig['diagnostics'] = [];
    const providers: string[] = [];
    const install = { installed: true };
    const hooks: LanguageServerHooks = {
        status: (server) => states.push(server.state),
        diagnostics: (doc, component, params) => diagnostics.push({ path: doc.storedPath, component, params }),
        providers: (doc) => providers.push(doc.storedPath),
        applyEdit: async () => ({ applied: false })
    };
    const server = new LanguageServer({
        kind,
        profile: KIND_PROFILES[kind],
        projectId: 'p1',
        folder: '/work',
        installDirectory: `/home/language-servers/${kind}`,
        isInstalled: async () => install.installed,
        runtime,
        spawn: spawner.spawn,
        clock,
        exists: async () => false,
        readText: async () => null,
        realPath: async (path) => path,
        hooks
    });
    return { server, spawner, clock, states, diagnostics, providers, install };
}

describe('a language server of one kind in one project', () => {
    it('starts on the first document, runs its script under the daemon runtime and opens what waited', async () => {
        const { server, spawner, states } = rig('vue');
        const main = document('/work/src/a.ts', 'typescript', 'let a = 1;');
        server.attach(main);
        await settle();
        expect(states).toEqual(['starting', 'ready']);
        expect(server.state).toBe('ready');
        const [process] = spawner.processes;
        expect(process.spec.command).toBe('/ruimte');
        expect(process.spec.env.BUN_BE_BUN).toBe('1');
        expect(process.spec.cwd).toBe('/work');
        expect(process.spec.args[0]).toBe('/home/language-servers/vue/node_modules/typescript-language-server/lib/cli.mjs');
        expect(process.spec.args.slice(1)).toEqual(['--stdio']);
        expect(process.server.documents.get('file:///work/src/a.ts')).toEqual({ languageId: 'typescript', text: 'let a = 1;', version: 1 });
        expect(Object.keys(server.capabilities ?? {})).toEqual(['typescript', 'vue']);
    });

    it('runs the native TypeScript server as a program of its own, not under the daemon runtime', async () => {
        const { server, spawner } = rig('typescript');
        server.attach(document('/work/src/a.ts', 'typescript', 'let a = 1;'));
        await settle();
        const [process] = spawner.processes;
        expect(process.spec.command).toBe(
            `/home/language-servers/typescript/node_modules/@typescript/typescript-${globalThis.process.platform}-${globalThis.process.arch}/lib/${globalThis.process.platform === 'win32' ? 'tsc.exe' : 'tsc'}`
        );
        expect(process.spec.args).toEqual(['--lsp', '--stdio']);
        expect(process.spec.env.BUN_BE_BUN).toBeUndefined();
        expect(process.name).toBe('typescript');
        expect(process.server.documents.get('file:///work/src/a.ts')).toEqual({ languageId: 'typescript', text: 'let a = 1;', version: 1 });
    });

    it('starts nothing while the kind is not installed, and starts once it is', async () => {
        const { server, spawner, install, states } = rig('php');
        install.installed = false;
        server.attach(document('/work/a.php', 'php', '<?php'));
        await settle();
        expect(spawner.processes).toHaveLength(0);
        expect(server.state).toBe('stopped');
        install.installed = true;
        await server.ensureStarted();
        expect(spawner.processes).toHaveLength(1);
        expect(states.at(-1)).toBe('ready');
    });

    it('forwards changes to what the server holds, and the server sees the same text and version', async () => {
        const { server, spawner } = rig('typescript');
        const main = document('/work/a.ts', 'typescript', 'let a = 1;\n');
        server.attach(main);
        await settle();
        main.text = 'let a = 12;\n';
        main.version = 2;
        await server.change(main, [{ range: { start: { line: 0, character: 9 }, end: { line: 0, character: 9 } }, text: '2' }]);
        await settle();
        expect(spawner.processes[0].server.documents.get('file:///work/a.ts')).toEqual({ languageId: 'typescript', text: 'let a = 12;\n', version: 2 });
    });

    it('answers a feature from the server, with the process that answered and the version', async () => {
        const { server, spawner } = rig('typescript');
        const main = document('/work/a.ts', 'typescript', 'x');
        server.attach(main);
        await settle();
        spawner.processes[0].server.handle('textDocument/hover', () => ({ contents: 'hover' }));
        expect(await server.request(main, 'textDocument/hover', { position: { line: 0, character: 0 } })).toEqual({
            result: { contents: 'hover' },
            server: 'typescript',
            version: 1
        });
        await expect(server.request(main, 'textDocument/definition', {})).rejects.toMatchObject({ code: -32601 });
    });

    it('refuses a request while it is not up', async () => {
        const { server, install } = rig('php');
        install.installed = false;
        const main = document('/work/a.php', 'php', '');
        server.attach(main);
        await settle();
        await expect(server.request(main, 'textDocument/hover', {})).rejects.toMatchObject({ code: -32002 });
    });

    it('hears diagnostics and passes them on with the process they came from', async () => {
        const { server, spawner, diagnostics } = rig('typescript');
        const main = document('/work/src/a.ts', 'typescript', 'x');
        server.attach(main);
        await settle();
        const diagnostic = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'nope' };
        await spawner.processes[0].server.publishDiagnostics('file:///work/src/a.ts', [diagnostic], 1);
        await settle();
        expect(diagnostics).toEqual([
            { path: 'src/a.ts', component: 'typescript', params: { uri: 'file:///work/src/a.ts', version: 1, diagnostics: [diagnostic] } }
        ]);
    });

    it('reads work in progress as indexing, and goes back to ready when it ends', async () => {
        const { server, spawner, states } = rig('typescript');
        server.attach(document('/work/a.ts', 'typescript', ''));
        await settle();
        const process = spawner.processes[0];
        await process.server.notify('$/progress', { token: 't', value: { kind: 'begin', title: 'Loading' } });
        await settle();
        expect(server.state).toBe('indexing');
        await process.server.notify('$/progress', { token: 't', value: { kind: 'end' } });
        await settle();
        expect(server.state).toBe('ready');
        expect(states.slice(-2)).toEqual(['indexing', 'ready']);
    });

    it('lists what each document may ask by the options its server gave', async () => {
        const { server } = rig('typescript');
        const main = document('/work/a.ts', 'typescript', '');
        server.attach(main);
        await settle();
        const providers = server.providers(main, ['textDocument/hover', 'textDocument/completion', 'textDocument/definition', 'textDocument/prepareRename']);
        expect(providers).toEqual({
            'textDocument/hover': {},
            'textDocument/completion': { resolveProvider: true, triggerCharacters: ['.'] },
            'textDocument/prepareRename': { prepareProvider: true }
        });
    });

    it('marks itself crashed when the process ends, says why, and stays crashed with its documents kept', async () => {
        const { server, spawner, states } = rig('typescript');
        const main = document('/work/a.ts', 'typescript', 'x');
        server.attach(main);
        await settle();
        spawner.processes[0].say('RangeError: out of memory');
        await spawner.processes[0].crash(137);
        await settle();
        expect(server.state).toBe('crashed');
        expect(server.message).toBe('The typescript language server exited with code 137: RangeError: out of memory');
        expect(states.at(-1)).toBe('crashed');
        expect(server.documentCount).toBe(1);
        await server.ensureStarted();
        expect(spawner.processes).toHaveLength(1);
        server.attach(document('/work/b.ts', 'typescript', ''));
        await settle();
        expect(server.state).toBe('crashed');
    });

    it('marks itself crashed when the process dies before the handshake is done', async () => {
        const spawner = fakeSpawner();
        const spawn = spawner.spawn;
        spawner.spawn = (spec) => {
            const child = spawn(spec);
            void spawner.processes.at(-1)?.crash(2);
            return child;
        };
        const { server } = rig('typescript', spawner);
        server.attach(document('/work/a.ts', 'typescript', ''));
        await settle();
        expect(server.state).toBe('crashed');
        expect(server.message).toContain('typescript language server');
    });

    it('starts again on a restart and opens the documents with the text and version they have now', async () => {
        const { server, spawner } = rig('typescript');
        const main = document('/work/a.ts', 'typescript', 'old');
        server.attach(main);
        await settle();
        await spawner.processes[0].crash();
        await settle();
        expect(server.state).toBe('crashed');
        main.text = 'newer';
        main.version = 5;
        await server.restart();
        expect(server.state).toBe('ready');
        expect(server.message).toBeUndefined();
        expect(spawner.processes).toHaveLength(2);
        expect(spawner.processes[1].server.documents.get('file:///work/a.ts')).toEqual({ languageId: 'typescript', text: 'newer', version: 5 });
    });

    it('stops its processes with a polite shutdown and a kill after, and the clock decides the grace', async () => {
        const { server, spawner, clock } = rig('typescript');
        server.attach(document('/work/a.ts', 'typescript', ''));
        await settle();
        const process = spawner.processes[0];
        await server.stop();
        expect(process.server.shutdownRequested).toBe(true);
        expect(process.server.exited).toBe(true);
        expect(process.kills).toEqual(['SIGTERM']);
        expect(server.state).toBe('stopped');
        expect(clock.pending).toBe(0);
    });

    it('kills a process that does not go when the grace passes', async () => {
        const { server, spawner, clock } = rig('typescript');
        server.attach(document('/work/a.ts', 'typescript', ''));
        await settle();
        const process = spawner.processes[0];
        process.stubborn = true;
        const stopped = server.stop();
        await settle();
        expect(process.kills).toEqual(['SIGTERM']);
        expect(clock.pending).toBe(1);
        clock.fire();
        await stopped;
        expect(process.kills).toEqual(['SIGTERM', 'SIGKILL']);
        expect(server.state).toBe('stopped');
    });

    it('does not start when it was stopped while the install was being looked up', async () => {
        const { server, spawner } = rig('typescript');
        server.attach(document('/work/a.ts', 'typescript', ''));
        await server.stop();
        await settle();
        expect(spawner.processes).toHaveLength(0);
        expect(server.state).toBe('stopped');
    });

    it('stays out of the way of a document of a language it does not serve', () => {
        const { server } = rig('typescript');
        expect(server.serves('typescriptreact')).toBe(true);
        expect(server.serves('php')).toBe(false);
    });
});

describe('a server that is asked for its diagnostics', () => {
    const PULLING: Partial<Record<string, ServerCapabilities>> = {
        css: { textDocumentSync: 2, diagnosticProvider: { interFileDependencies: false, workspaceDiagnostics: false } }
    };

    it('is asked when a document opens, and again when typing pauses after a change', async () => {
        const { server, spawner, diagnostics, clock } = rig('css', fakeSpawner(PULLING));
        const sheet = document('/work/a.css', 'css', 'a { colr: red }');
        server.attach(sheet);
        await settle();
        const item: Diagnostic = { range: { start: { line: 0, character: 4 }, end: { line: 0, character: 8 } }, message: 'Unknown property', severity: 2 };
        let answered = 0;
        spawner.processes[0].server.handle('textDocument/diagnostic', () => {
            answered++;
            return { kind: 'full', items: [item] };
        });
        sheet.version = 2;
        await server.change(sheet, [{ text: 'a { color: red }' }]);
        expect(answered).toBe(0);
        expect(clock.pending).toBe(1);
        clock.fire();
        await settle();
        expect(answered).toBe(1);
        expect(diagnostics.at(-1)).toEqual({ path: 'a.css', component: 'css', params: { uri: 'file:///work/a.css', version: 2, diagnostics: [item] } });
    });

    it('is not asked once the document is gone', async () => {
        const { server, spawner, clock, diagnostics } = rig('css', fakeSpawner(PULLING));
        const sheet = document('/work/a.css', 'css', 'a {}');
        server.attach(sheet);
        await settle();
        spawner.processes[0].server.handle('textDocument/diagnostic', () => ({ kind: 'full', items: [] }));
        await server.change(sheet, [{ text: 'b {}' }]);
        await server.detach(sheet);
        expect(clock.pending).toBe(0);
        clock.fire();
        await settle();
        expect(diagnostics).toEqual([]);
    });

    it('leaves a server that pushes alone', async () => {
        const { server, spawner, clock } = rig('vue', fakeSpawner({ typescript: PULLING.css }));
        const script = document('/work/a.ts', 'typescript', 'x');
        server.attach(script);
        await settle();
        await server.change(script, [{ text: 'y' }]);
        expect(clock.pending).toBe(0);
        expect(spawner.processes[0].server.received.some((message) => message.method === 'textDocument/diagnostic')).toBe(false);
    });
});

describe('the native TypeScript server and its diagnostics', () => {
    const NATIVE: Partial<Record<string, ServerCapabilities>> = {
        typescript: { textDocumentSync: 2, diagnosticProvider: { identifier: 'typescript', interFileDependencies: true, workspaceDiagnostics: false } }
    };
    const item: Diagnostic = { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 1 } }, message: 'Cannot find name', severity: 1 };

    it('asks again for every open document when one changes, since a document depends on the others', async () => {
        const { server, spawner, clock, diagnostics } = rig('typescript', fakeSpawner(NATIVE));
        const first = document('/work/src/a.ts', 'typescript', 'a');
        const second = document('/work/src/b.ts', 'typescript', 'b');
        server.attach(first);
        server.attach(second);
        await settle();
        const asked: string[] = [];
        spawner.processes[0].server.handle('textDocument/diagnostic', (params) => {
            asked.push((params as { textDocument: { uri: string } }).textDocument.uri);
            return { kind: 'full', items: [item] };
        });
        first.version = 2;
        await server.change(first, [{ text: 'a2' }]);
        expect(clock.pending).toBe(2);
        clock.fire();
        await settle();
        expect(asked.sort()).toEqual(['file:///work/src/a.ts', 'file:///work/src/b.ts']);
        expect(diagnostics.map((report) => report.path).sort()).toEqual(['src/a.ts', 'src/b.ts']);
    });

    it('asks for every open document when the server refreshes its diagnostics', async () => {
        const { server, spawner, clock } = rig('typescript', fakeSpawner(NATIVE));
        server.attach(document('/work/src/a.ts', 'typescript', 'a'));
        server.attach(document('/work/src/b.ts', 'typescript', 'b'));
        await settle();
        await spawner.processes[0].server.connection.request('workspace/diagnostic/refresh');
        await settle();
        expect(clock.pending).toBe(2);
    });

    it('reports the documents a report carries along, when the server has them open', async () => {
        const { server, spawner, clock, diagnostics } = rig('typescript', fakeSpawner(NATIVE));
        const first = document('/work/src/a.ts', 'typescript', 'a');
        server.attach(first);
        server.attach(document('/work/src/b.ts', 'typescript', 'b'));
        await settle();
        spawner.processes[0].server.handle('textDocument/diagnostic', (params) =>
            (params as { textDocument: { uri: string } }).textDocument.uri === 'file:///work/src/a.ts'
                ? {
                      kind: 'full',
                      items: [],
                      relatedDocuments: {
                          'file:///work/src/b.ts': { kind: 'full', items: [item] },
                          'file:///work/src/closed.ts': { kind: 'full', items: [item] }
                      }
                  }
                : { kind: 'full', items: [] }
        );
        first.version = 2;
        await server.change(first, [{ text: 'a2' }]);
        clock.fire();
        await settle();
        expect(diagnostics.filter((report) => report.params.diagnostics.length > 0)).toEqual([
            { path: 'src/b.ts', component: 'typescript', params: { uri: 'file:///work/src/b.ts', version: 1, diagnostics: [item] } }
        ]);
    });
});

describe('the Vue pair', () => {
    it('starts the TypeScript server first with the plugin, then Vue, and opens a .vue document in both', async () => {
        const { server, spawner } = rig('vue');
        const sfc = document('/work/App.vue', 'vue', '<template><p>{{ n }}</p></template>\n<script setup lang="ts">\nconst n = 1;\n</script>\n');
        server.attach(sfc);
        await settle();
        expect(spawner.processes.map((process) => process.name)).toEqual(['typescript', 'vue']);
        expect(spawner.processes[1].spec.args.at(-1)).toBe('--tsdk=/home/language-servers/vue/node_modules/typescript/lib');
        for (const process of spawner.processes) {
            expect(process.server.documents.get('file:///work/App.vue')?.languageId).toBe('vue');
        }
        expect(Object.keys(server.capabilities ?? {})).toEqual(['typescript', 'vue']);
    });

    it('opens a script in the TypeScript server only, which loads the plugin, so one tsserver serves the whole project', async () => {
        const { server, spawner } = rig('vue');
        const script = document('/work/src/main.ts', 'typescript', "import App from './App.vue';\n");
        server.attach(script);
        await settle();
        const [typescript, vue] = spawner.processes;
        expect(typescript.server.documents.get('file:///work/src/main.ts')?.languageId).toBe('typescript');
        expect(vue.server.documents.has('file:///work/src/main.ts')).toBe(false);
        expect(spawner.processes.filter((process) => process.name === 'typescript')).toHaveLength(1);
        typescript.server.handle('textDocument/hover', () => ({ contents: 'from typescript' }));
        expect((await server.request(script, 'textDocument/hover', { position: { line: 0, character: 3 } })).server).toBe('typescript');
    });

    it('relays the tsserver requests of Vue to the TypeScript server and answers Vue', async () => {
        const { server, spawner } = rig(
            'vue',
            fakeSpawner({ typescript: { textDocumentSync: 2, executeCommandProvider: { commands: ['typescript.tsserverRequest'] } } })
        );
        server.attach(document('/work/App.vue', 'vue', ''));
        await settle();
        const [typescript, vue] = spawner.processes;
        typescript.server.handle('workspace/executeCommand', () => ({ body: { configFileName: '/work/tsconfig.json' } }));
        const answered: unknown[] = [];
        vue.server.connection.onNotification('tsserver/response', (params) => {
            answered.push(params);
        });
        await vue.server.notify('tsserver/request', [[3, '_vue:projectInfo', { file: '/work/App.vue' }]]);
        await settle();
        expect(answered).toEqual([[[3, { configFileName: '/work/tsconfig.json' }]]]);
    });

    it('asks TypeScript inside a script and an expression, Vue elsewhere, and the other when one does not support it', async () => {
        const { server, spawner } = rig('vue');
        const text = '<template>\n  <p>{{ count }}</p>\n</template>\n<script setup lang="ts">\nconst count = 1;\n</script>\n';
        const sfc = document('/work/App.vue', 'vue', text);
        server.attach(sfc);
        await settle();
        const [typescript, vue] = spawner.processes;
        typescript.server.handle('textDocument/hover', () => ({ contents: 'from typescript' }));
        vue.server.handle('textDocument/hover', () => ({ contents: 'from vue' }));
        const at = (line: number, character: number) => ({ position: { line, character } });
        expect((await server.request(sfc, 'textDocument/hover', at(1, 3))).server).toBe('vue');
        expect((await server.request(sfc, 'textDocument/hover', at(1, 9))).server).toBe('typescript');
        expect((await server.request(sfc, 'textDocument/hover', at(4, 8))).server).toBe('typescript');
        vue.server.handle('textDocument/completion', () => []);
        expect((await server.request(sfc, 'textDocument/completion', at(1, 3))).server).toBe('vue');
        const only = fakeSpawner({ vue: { textDocumentSync: 2 }, typescript: { textDocumentSync: 2, hoverProvider: true } });
        const second = rig('vue', only);
        const copy = document('/work/B.vue', 'vue', text);
        second.server.attach(copy);
        await settle();
        only.processes[0].server.handle('textDocument/hover', () => ({ contents: 'fallback' }));
        expect(await second.server.request(copy, 'textDocument/hover', at(1, 3))).toMatchObject({ server: 'typescript', result: { contents: 'fallback' } });
    });

    it('resolves an item with the process that produced it', async () => {
        const { server, spawner } = rig('vue');
        const sfc = document('/work/App.vue', 'vue', '<template></template>');
        server.attach(sfc);
        await settle();
        const [typescript, vue] = spawner.processes;
        typescript.server.handle('completionItem/resolve', (item) => ({ ...(item as object), detail: 'ts' }));
        vue.server.handle('completionItem/resolve', (item) => ({ ...(item as object), detail: 'vue' }));
        expect((await server.request(sfc, 'completionItem/resolve', { label: 'a' }, 'typescript')).result).toEqual({ label: 'a', detail: 'ts' });
        expect((await server.request(sfc, 'completionItem/resolve', { label: 'a' }, 'vue')).result).toEqual({ label: 'a', detail: 'vue' });
    });

    it('is crashed as a whole when either process goes, and the other is killed', async () => {
        const { server, spawner } = rig('vue');
        server.attach(document('/work/App.vue', 'vue', ''));
        await settle();
        await spawner.processes[0].crash();
        await settle();
        expect(server.state).toBe('crashed');
        expect(server.message).toContain('typescript language server exited');
        expect(spawner.processes[1].kills).toEqual(['SIGTERM']);
    });
});
