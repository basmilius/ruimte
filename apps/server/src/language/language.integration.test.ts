import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageServerKind, LanguageRequestResult } from '@ruimte/contracts';
import type { Diagnostic, Position } from '@ruimte/smart-editor-lsp';
import { MachineHome } from '../fs/machine-home.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { LanguageHost } from './host.ts';
import { runCommand, spawnLanguageProcess, type LanguageExit, type LanguageRuntime } from './runtime.ts';

/*
 * Real installs and real servers, run the way the compiled daemon runs them: a `bun build --compile`
 * executable acting as the bun CLI with BUN_BE_BUN=1. The stub compiled here is that same runtime, so
 * what works under it works under the daemon. It needs the network once, for `bun install`.
 */

const FILES: Record<string, string> = {
    'tsconfig.json': JSON.stringify({
        compilerOptions: { strict: true, target: 'ES2022', module: 'ESNext', moduleResolution: 'Bundler' },
        include: ['src', '*.vue']
    }),
    'package.json': JSON.stringify({ private: true, type: 'module', dependencies: { vue: '3.5.43' } }),
    'src/helpers.ts': 'export function greet(name: string): string {\n    return `Hello, ${name}`;\n}\n',
    'src/a.ts':
        "import { greet } from './helpers.ts';\n\nconst count: number = 'one';\nexport function add(a: number, b: number) {\n    return a + b;\n}\nadd(1, 2);\ngreet('Ada');\n",
    'Counter.vue': [
        '<template>',
        '  <button @click="increase(1)">{{ count.toFixed(0) }}</button>',
        '</template>',
        '',
        '<script setup lang="ts">',
        "import { ref } from 'vue';",
        '',
        'const count = ref(1);',
        '',
        'function increase(amount: number): number {',
        '  count.value += amount;',
        '  return count.value;',
        '}',
        '</script>',
        ''
    ].join('\n'),
    'main.php':
        "<?php\ndeclare(strict_types=1);\n\nfunction greet(string $name): string\n{\n    return 'Hello, ' . $name;\n}\n\n$message = greet('Ada');\necho $message;\n"
};

/* A project that does not use Vue, whose TypeScript stays on the TypeScript kind. */
const PLAIN_FILES: Record<string, string> = {
    'tsconfig.json': FILES['tsconfig.json'],
    'package.json': JSON.stringify({ private: true, type: 'module' }),
    'src/helpers.ts': FILES['src/helpers.ts'],
    'src/a.ts': FILES['src/a.ts']
};

/* The Vue project's own script, which imports a component. */
const SCRIPT_FILES: Record<string, string> = {
    'src/use-counter.ts': "import Counter from '../Counter.vue';\n\nexport const component = Counter;\nexport const wrong: string = 1;\n"
};

let base = '';
let project = '';
let plain = '';
let host: LanguageHost;
let runtime: LanguageRuntime;
const events: SessionEvent[] = [];
const exits: Promise<LanguageExit>[] = [];

async function eventually<T>(what: string, run: () => Promise<T> | T, accept: (value: T) => boolean = Boolean, timeoutMs = 90_000): Promise<T> {
    const deadline = Date.now() + timeoutMs;
    let last: unknown;
    while (Date.now() < deadline) {
        try {
            const value = await run();
            if (accept(value)) {
                return value;
            }
            last = value;
        } catch (error) {
            last = error;
        }
        await Bun.sleep(100);
    }
    throw new Error(`${what} never happened (last: ${last instanceof Error ? last.message : JSON.stringify(last)?.slice(0, 300)})`);
}

function positionOf(text: string, needle: string, offset = 0): Position {
    const index = text.indexOf(needle) + offset;
    const before = text.slice(0, index).split('\n');
    return { line: before.length - 1, character: before[before.length - 1].length };
}

async function ask(path: string, method: string, params: unknown, projectId = 'p1'): Promise<LanguageRequestResult> {
    return host.request({ projectId, path, method: method as never, params });
}

function diagnosticsOf(path: string, server?: string): Diagnostic[] {
    const reports = events.filter(
        (event) => event.event === 'language.diagnostics' && event.payload.path === path && (!server || event.payload.server === server)
    );
    const last = reports.at(-1);
    return last && last.event === 'language.diagnostics' ? (last.payload.diagnostics as Diagnostic[]) : [];
}

async function waitReady(kind: LanguageServerKind, projectId = 'p1'): Promise<void> {
    await eventually(
        `${kind} ready`,
        async () => (await host.status(projectId)).find((status) => status.server === kind),
        (status) => status?.state === 'ready' || status?.state === 'indexing'
    );
}

async function install(kind: LanguageServerKind): Promise<void> {
    await host.install(kind);
    await eventually(
        `${kind} install`,
        async () => (await host.status('p1')).find((status) => status.server === kind),
        (status) => status?.state === 'stopped' || (status?.state === 'not-installed' && status.message !== undefined)
    );
    const status = (await host.status('p1')).find((candidate) => candidate.server === kind);
    if (status?.state !== 'stopped') {
        throw new Error(`Installing ${kind} failed: ${status?.message}\n${(await host.log('p1', kind)).map((line) => line.text).join('\n')}`);
    }
}

beforeAll(async () => {
    base = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-language-')));
    project = join(base, 'project');
    plain = join(base, 'plain');
    for (const [root, files] of [
        [project, { ...FILES, ...SCRIPT_FILES }],
        [plain, PLAIN_FILES]
    ] as const) {
        for (const [path, text] of Object.entries(files)) {
            await mkdir(join(root, path, '..'), { recursive: true });
            await writeFile(join(root, path), text);
        }
    }
    const stub = join(base, 'ruimte-runtime');
    await writeFile(join(base, 'stub.ts'), "console.log('ruimte-runtime-stub');\n");
    const build = Bun.spawnSync(['bun', 'build', '--compile', join(base, 'stub.ts'), '--outfile', stub], { stdio: ['ignore', 'ignore', 'inherit'] });
    expect(build.exitCode).toBe(0);
    if (process.platform === 'darwin') {
        // What apps/server/scripts/compile.ts does, since the kernel refuses to start the binary otherwise.
        expect(Bun.spawnSync(['codesign', '--sign', '-', '--force', stub], { stdio: ['ignore', 'ignore', 'inherit'] }).exitCode).toBe(0);
    }
    runtime = { command: stub, args: [], env: { BUN_BE_BUN: '1' } };
    host = new LanguageHost({
        root: join(base, 'home', 'language-servers'),
        folderOf: (projectId) => (projectId === 'p1' ? project : projectId === 'p2' ? plain : null),
        holders: () => ['c1'],
        machineHome: new MachineHome(join(base, 'home')),
        runtime,
        spawn: (spec) => {
            const child = spawnLanguageProcess(spec);
            exits.push(child.exited);
            return child;
        }
    });
    host.subscribe('c1', (event) => events.push(event));
    // The Vue server needs `vue` in the project to type a template.
    expect(await runCommand({ command: stub, args: ['install', '--ignore-scripts'], cwd: project, env: runtime.env }, () => undefined)).toBe(0);
}, 180_000);

afterAll(async () => {
    await host?.close();
    await rm(base, { recursive: true, force: true });
});

describe('the runtime of a compiled daemon', () => {
    test('is a standalone executable that becomes the bun CLI only when asked to', () => {
        const alone = Bun.spawnSync([runtime.command], { env: { PATH: process.env.PATH ?? '' } });
        expect(alone.stdout.toString().trim()).toBe('ruimte-runtime-stub');
        const asBun = Bun.spawnSync([runtime.command, '-e', 'console.log(process.versions.bun)'], {
            env: { PATH: process.env.PATH ?? '', ...runtime.env }
        });
        expect(asBun.stdout.toString()).toContain(Bun.version);
    });
});

describe('TypeScript', () => {
    test('installs, starts on a document and answers features', async () => {
        await install('typescript');
        const text = FILES['src/a.ts'];
        const opened = await host.open('c1', { projectId: 'p2', path: 'src/a.ts', languageId: 'typescript', text });
        expect(opened).toMatchObject({ version: 1, servers: ['typescript'] });
        await waitReady('typescript', 'p2');

        const diagnostics = await eventually(
            'a type error',
            () => diagnosticsOf('src/a.ts'),
            (list) => list.some((item) => /not assignable/.test(item.message))
        );
        expect(diagnostics.some((item) => item.severity === 1)).toBe(true);

        const hover = await eventually(
            'a hover',
            () => ask('src/a.ts', 'textDocument/hover', { position: positionOf(text, 'add(a', 0) }, 'p2').then((reply) => reply.result),
            Boolean
        );
        expect(JSON.stringify(hover)).toContain('function add');

        const hints = await ask('src/a.ts', 'textDocument/inlayHint', { range: { start: { line: 0, character: 0 }, end: { line: 8, character: 0 } } }, 'p2');
        expect((hints.result as { kind?: number }[]).filter((hint) => hint.kind === 2).length).toBeGreaterThanOrEqual(2);

        const providers = (await host.open('c1', { projectId: 'p2', path: 'src/a.ts', languageId: 'typescript', text })).providers;
        expect(Object.keys(providers)).toEqual(expect.arrayContaining(['textDocument/hover', 'textDocument/completion', 'textDocument/inlayHint']));
    }, 180_000);

    test('follows an incremental change and completes against the new text', async () => {
        const text = FILES['src/a.ts'];
        const end = positionOf(text, "greet('Ada');\n", "greet('Ada');\n".length);
        const changed = await host.change({
            projectId: 'p2',
            path: 'src/a.ts',
            baseVersion: 1,
            changes: [{ range: { start: end, end }, text: 'add(1, 2).toF' }]
        });
        expect(changed.version).toBe(2);
        const after = { line: end.line, character: 'add(1, 2).toF'.length };
        const completion = await eventually(
            'a completion',
            () => ask('src/a.ts', 'textDocument/completion', { position: after }, 'p2'),
            (reply) => JSON.stringify(reply.result).includes('toFixed')
        );
        expect(completion.version).toBe(2);
        await expect(host.change({ projectId: 'p2', path: 'src/a.ts', baseVersion: 1, changes: [{ text: '' }] })).rejects.toMatchObject({
            code: 'stale-document'
        });
    }, 60_000);

    test('renames across files and formats', async () => {
        const rename = await ask('src/a.ts', 'textDocument/rename', { position: positionOf(FILES['src/a.ts'], 'add(a', 0), newName: 'sum' }, 'p2');
        expect(JSON.stringify(rename.result)).toContain('sum');
        const formatted = await ask('src/a.ts', 'textDocument/formatting', { options: { tabSize: 4, insertSpaces: true } }, 'p2');
        expect(Array.isArray(formatted.result)).toBe(true);
    }, 60_000);

    test('ends the server with its last document', async () => {
        const before = exits.length;
        await host.closeDocument('c1', { projectId: 'p2', path: 'src/a.ts' });
        await eventually(
            'the server stopping',
            async () => (await host.status('p2')).find((status) => status.server === 'typescript'),
            (status) => status?.state === 'stopped'
        );
        await Promise.all(exits.slice(0, before));
    }, 60_000);
});

describe('Vue', () => {
    test('pairs the Vue server with TypeScript and routes by where the caret is', async () => {
        await install('vue');
        const text = FILES['Counter.vue'];
        await host.open('c1', { projectId: 'p1', path: 'Counter.vue', languageId: 'vue', text });
        await waitReady('vue');
        const status = (await host.status('p1')).find((candidate) => candidate.server === 'vue');
        expect(Object.keys(status?.capabilities ?? {})).toEqual(['typescript', 'vue']);

        const expression = await eventually(
            'a typed template expression',
            () => ask('Counter.vue', 'textDocument/hover', { position: positionOf(text, 'count.toFixed', 2) }),
            (reply) => JSON.stringify(reply.result).includes('number')
        );
        expect(expression.server).toBe('typescript');

        const markup = await eventually(
            'a template hover',
            () => ask('Counter.vue', 'textDocument/hover', { position: positionOf(text, '<button', 3) }),
            (reply) => reply.result !== null
        );
        expect(markup.server).toBe('vue');

        const completion = await eventually(
            'a member completion',
            () => ask('Counter.vue', 'textDocument/completion', { position: positionOf(text, 'count.toFixed', 'count.toF'.length) }),
            (reply) => JSON.stringify(reply.result).includes('toFixed')
        );
        expect(completion.server).toBe('typescript');
    }, 180_000);

    test('serves a script that imports a component from the same TypeScript server, so it is typed and no second tsserver starts', async () => {
        const text = SCRIPT_FILES['src/use-counter.ts'];
        const processesBefore = exits.length;
        const opened = await host.open('c1', { projectId: 'p1', path: 'src/use-counter.ts', languageId: 'typescript', text });
        expect(opened.servers).toEqual(['vue']);
        // Only a type error of its own: with the plugin the `.vue` import resolves, without it the module is not found.
        const diagnostics = await eventually(
            'script diagnostics',
            () => diagnosticsOf('src/use-counter.ts', 'typescript'),
            (list) => list.some((item) => /not assignable/.test(item.message))
        );
        expect(diagnostics.some((item) => /Cannot find module/.test(item.message))).toBe(false);
        const hover = await eventually(
            'a hover on the component',
            () => ask('src/use-counter.ts', 'textDocument/hover', { position: positionOf(text, 'Counter;', 2) }),
            (reply) => reply.result !== null
        );
        expect(hover.server).toBe('typescript');
        expect(JSON.stringify(hover.result)).toContain('Counter');
        expect(exits.length).toBe(processesBefore);
        const statuses = await host.status('p1');
        expect(statuses.find((status) => status.server === 'typescript')?.state).toBe('stopped');
        await host.closeDocument('c1', { projectId: 'p1', path: 'src/use-counter.ts' });
    }, 180_000);

    test('reports a script error after a change and clears it when the text is put back', async () => {
        const text = FILES['Counter.vue'];
        const line = positionOf(text, 'ref(1)').line;
        const column = (prefix: string): Position => ({ line, character: prefix.length });
        // `const count = ref(1);` becomes `const count = ref<number>('wrong');` in two entries.
        const changed = await host.change({
            projectId: 'p1',
            path: 'Counter.vue',
            baseVersion: 1,
            changes: [
                { range: { start: column('const count = ref'), end: column('const count = ref') }, text: '<number>' },
                { range: { start: column('const count = ref<number>('), end: column('const count = ref<number>(1') }, text: "'wrong'" }
            ]
        });
        expect(changed.version).toBe(2);
        await eventually(
            'a script error',
            () => diagnosticsOf('Counter.vue'),
            (list) => list.some((item) => item.severity === 1)
        );
        await host.change({ projectId: 'p1', path: 'Counter.vue', baseVersion: 2, changes: [{ text }] });
        await eventually(
            'the error gone',
            () => diagnosticsOf('Counter.vue', 'typescript'),
            (list) => list.length === 0
        );
    }, 120_000);
});

describe('PHP', () => {
    test('installs, answers features and reports diagnostics', async () => {
        await install('php');
        const text = FILES['main.php'];
        await host.open('c1', { projectId: 'p1', path: 'main.php', languageId: 'php', text });
        await waitReady('php');
        const hover = await eventually(
            'a hover',
            () => ask('main.php', 'textDocument/hover', { position: positionOf(text, "greet('Ada')", 2) }),
            (reply) => reply.result !== null
        );
        expect(JSON.stringify(hover.result)).toContain('greet');
        const completion = await ask('main.php', 'textDocument/completion', { position: positionOf(text, "greet('Ada')", 3) });
        expect(JSON.stringify(completion.result)).toContain('greet');
        const end = { line: 10, character: 0 };
        await host.change({
            projectId: 'p1',
            path: 'main.php',
            baseVersion: 1,
            changes: [{ range: { start: end, end }, text: 'unknown_function_for_smoke();\n' }]
        });
        await eventually(
            'an undefined function',
            () => diagnosticsOf('main.php'),
            (list) => list.some((item) => /unknown_function_for_smoke/.test(item.message) || item.severity === 1)
        );
    }, 180_000);
});

describe('the project closing', () => {
    test('ends every server and leaves no process behind', async () => {
        await host.end('p1');
        const results = await Promise.all(exits);
        expect(results.length).toBeGreaterThanOrEqual(4);
        expect((await host.status('p1')).every((status) => status.state === 'stopped')).toBe(true);
    }, 60_000);
});
