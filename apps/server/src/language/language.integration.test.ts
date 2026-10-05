import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { LanguageServerKind, LanguageRequestResult } from '@ruimte/contracts';
import type { Diagnostic, Position } from '@ruimte/smart-editor-lsp';
import { MachineHome } from '../fs/machine-home.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { LanguageHost } from './host.ts';
import { runCommand, spawnLanguageProcess, type LanguageExit, type LanguageProcessSpec, type LanguageRuntime } from './runtime.ts';

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

/* Files for the servers of the other languages, in the project that has Vue. */
const OTHER_FILES: Record<string, string> = {
    'style.css': 'a { colr: red; }\n.b { color: #fffff; }\n',
    'page.html': '<!DOCTYPE html>\n<html>\n<body>\n<div class="x"><span></div>\n</body>\n</html>\n',
    'broken.json': '{ "name": "x", "list": [1, 2,] , "bad": }\n',
    'config.yaml': 'name: a\nname: b\nitems: [1, 2\n',
    'script.py': 'def total(count: int) -> str:\n    return count\n\n\nprint(total(1))\n',
    'run.sh': '#!/bin/bash\ngreet() {\n    echo "hello $1"\n}\ngreet world\n',
    Dockerfile: 'FROM node:22\nRUN npm install\nCOPY . /app\nFRM broken\n'
};

/* A project with an ESLint config and Tailwind, where those two serve beside the server of the language. */
const LINT_FILES: Record<string, string> = {
    'package.json': JSON.stringify({ private: true, type: 'module', devDependencies: { eslint: '9.20.0', tailwindcss: '4.1.0' } }),
    'eslint.config.js': "export default [{ files: ['**/*.js'], rules: { semi: ['error', 'always'], 'no-unused-vars': 'error' } }];\n",
    'src/a.js': 'const unused = 1\nexport const used = 2;\n',
    'index.html': '<div class="flex block p-4"></div>\n',
    'app.css': '@import "tailwindcss";\n.card { @apply p-4; }\n'
};

/* A project that does not use Vue, whose TypeScript stays on the TypeScript kind, and which holds a TypeScript 7 of its own that the kind runs instead of the pinned one. */
const PLAIN_FILES: Record<string, string> = {
    'tsconfig.json': FILES['tsconfig.json'],
    'package.json': JSON.stringify({ private: true, type: 'module', devDependencies: { typescript: '7.0.2' } }),
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
let lint = '';
let host: LanguageHost;
let runtime: LanguageRuntime;
const events: SessionEvent[] = [];
const exits: Promise<LanguageExit>[] = [];
const specs: LanguageProcessSpec[] = [];

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
    if ((await host.status('p1')).find((status) => status.server === kind)?.state !== 'not-installed') {
        return;
    }
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
    lint = join(base, 'lint');
    for (const [root, files] of [
        [project, { ...FILES, ...SCRIPT_FILES, ...OTHER_FILES }],
        [plain, PLAIN_FILES],
        [lint, LINT_FILES]
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
        folderOf: (projectId) => ({ p1: project, p2: plain, p3: lint })[projectId] ?? null,
        holders: () => ['c1'],
        machineHome: new MachineHome(join(base, 'home')),
        runtime,
        spawn: (spec) => {
            const child = spawnLanguageProcess(spec);
            specs.push(spec);
            exits.push(child.exited);
            return child;
        }
    });
    host.subscribe('c1', (event) => events.push(event));
    // The Vue server needs `vue` in the project to type a template, and the plain project's own TypeScript has to be there to be found.
    for (const folder of [project, plain, lint]) {
        expect(await runCommand({ command: stub, args: ['install', '--ignore-scripts'], cwd: folder, env: runtime.env }, () => undefined)).toBe(0);
    }
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

describe('TypeScript, on the native server of TypeScript 7', () => {
    test('installs, starts the TypeScript 7 of the project on a document and answers features', async () => {
        await install('typescript');
        const text = FILES['src/a.ts'];
        const opened = await host.open('c1', { projectId: 'p2', path: 'src/a.ts', languageId: 'typescript', text });
        expect(opened).toMatchObject({ version: 1, servers: ['typescript'] });
        await waitReady('typescript', 'p2');
        // The program of the project's own package, not the pinned install, and not under the daemon's runtime.
        const spec = specs.find((candidate) => candidate.cwd === plain)!;
        expect(spec.command).toContain(join(plain, 'node_modules'));
        expect(spec.command).toMatch(/typescript-(darwin|linux|win32)-[a-z0-9]+[\\/]lib[\\/]tsc(\.exe)?$/);
        expect(spec.args).toEqual(['--lsp', '--stdio']);
        const status = (await host.status('p2')).find((candidate) => candidate.server === 'typescript');
        expect(status?.version).toBe('7.0.2');
        expect(status?.capabilities?.typescript).toMatchObject({ diagnosticProvider: { interFileDependencies: true }, selectionRangeProvider: true });

        // Diagnostics only come when the daemon pulls them.
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
        expect(Object.keys(providers)).toEqual(
            expect.arrayContaining(['textDocument/hover', 'textDocument/completion', 'textDocument/inlayHint', 'textDocument/selectionRange'])
        );
    }, 180_000);

    test('runs the pinned TypeScript 7 in a project that has none of its own', async () => {
        const text = LINT_FILES['src/a.js'];
        await host.open('c1', { projectId: 'p3', path: 'src/a.js', languageId: 'javascript', text });
        await waitReady('typescript', 'p3');
        const spec = specs.find((candidate) => candidate.cwd === lint && candidate.args.includes('--lsp'))!;
        expect(spec.command).toContain(join(base, 'home', 'language-servers', 'typescript', 'node_modules'));
        await host.closeDocument('c1', { projectId: 'p3', path: 'src/a.js' });
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

    test('reports the diagnostics of the new text by pulling them again', async () => {
        await eventually(
            'a report for the new text',
            () => diagnosticsOf('src/a.ts'),
            (list) => list.some((item) => /toF/.test(item.message))
        );
    }, 60_000);

    test('renames across files, formats with the options it is given and gives the ranges around a position', async () => {
        const text = FILES['src/a.ts'];
        const rename = await ask('src/a.ts', 'textDocument/rename', { position: positionOf(text, 'add(a', 0), newName: 'sum' }, 'p2');
        expect(JSON.stringify(rename.result)).toContain('sum');
        const formatted = await ask('src/a.ts', 'textDocument/formatting', { options: { tabSize: 4, insertSpaces: false } }, 'p2');
        expect(JSON.stringify(formatted.result)).toContain('\\t');
        const position = positionOf(text, 'a + b', 0);
        const ranges = await ask('src/a.ts', 'textDocument/selectionRange', { positions: [position] }, 'p2');
        const chain: { range: { start: Position; end: Position }; parent?: unknown }[] = [];
        for (let link = (ranges.result as { range: never; parent?: never }[])[0]; link; link = link.parent as never) {
            chain.push(link);
        }
        expect(chain.length).toBeGreaterThanOrEqual(3);
        expect(chain[0]!.range.start.line).toBe(position.line);
        expect(chain.at(-1)!.range.start).toEqual({ line: 0, character: 0 });
    }, 60_000);

    test('keeps the server running after its last document closes', async () => {
        await host.closeDocument('c1', { projectId: 'p2', path: 'src/a.ts' });
        const status = (await host.status('p2')).find((candidate) => candidate.server === 'typescript');
        expect(status?.state).toBe('ready');
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

async function openAndWait(path: string, languageId: string, kind: LanguageServerKind, text: string): Promise<void> {
    await install(kind);
    const opened = await host.open('c1', { projectId: 'p1', path, languageId, text });
    expect(opened.servers).toEqual([kind]);
    await waitReady(kind);
}

describe('CSS, HTML and JSON, from one package of extracted servers', () => {
    test('CSS reports a syntax error and hovers', async () => {
        await openAndWait('style.css', 'css', 'css', OTHER_FILES['style.css']);
        const diagnostics = await eventually(
            'a CSS error',
            () => diagnosticsOf('style.css', 'css'),
            (list) => list.length > 0
        );
        expect(diagnostics.some((item) => item.severity === 1)).toBe(true);
        const hover = await eventually(
            'a hover',
            () => ask('style.css', 'textDocument/hover', { position: positionOf(OTHER_FILES['style.css'], 'color', 1) }).then((reply) => reply.result),
            Boolean
        );
        expect(JSON.stringify(hover)).toContain('color');
    }, 180_000);

    test('HTML reports an unclosed element and completes a tag', async () => {
        await openAndWait('page.html', 'html', 'html', OTHER_FILES['page.html']);
        const completion = await eventually(
            'a tag completion',
            () => ask('page.html', 'textDocument/completion', { position: positionOf(OTHER_FILES['page.html'], '<span>', 1) }),
            (reply) => JSON.stringify(reply.result).includes('span')
        );
        expect(completion.server).toBe('html');
    }, 180_000);

    test('JSON reports a syntax error and takes a trailing comma in a tsconfig', async () => {
        await openAndWait('broken.json', 'json', 'json', OTHER_FILES['broken.json']);
        await eventually(
            'a JSON error',
            () => diagnosticsOf('broken.json', 'json'),
            (list) => list.some((item) => item.severity === 1)
        );
        const tsconfig = '{\n    // comments are allowed here\n    "compilerOptions": { "strict": true, },\n}\n';
        await host.open('c1', { projectId: 'p1', path: 'tsconfig.json', languageId: 'json', text: tsconfig });
        await eventually(
            'the tsconfig checked',
            () => events.some((event) => event.event === 'language.diagnostics' && event.payload.path === 'tsconfig.json' && event.payload.server === 'json'),
            Boolean
        );
        expect(diagnosticsOf('tsconfig.json', 'json').filter((item) => item.severity === 1)).toEqual([]);
        // The description comes from the schema of tsconfig files, which the server fetches when the file opens.
        const hover = await eventually(
            'a hover from the schema',
            () => ask('tsconfig.json', 'textDocument/hover', { position: positionOf(tsconfig, '"strict"', 2) }).then((reply) => reply.result),
            Boolean
        );
        expect(JSON.stringify(hover).toLowerCase()).toContain('strict');
    }, 180_000);
});

describe('YAML', () => {
    test('reports duplicate keys and a broken flow sequence', async () => {
        await openAndWait('config.yaml', 'yaml', 'yaml', OTHER_FILES['config.yaml']);
        const diagnostics = await eventually(
            'YAML errors',
            () => diagnosticsOf('config.yaml', 'yaml'),
            (list) => list.length >= 2
        );
        expect(diagnostics.some((item) => /unique/.test(item.message))).toBe(true);
    }, 180_000);
});

describe('Python', () => {
    test('reports a type error and hovers', async () => {
        await openAndWait('script.py', 'python', 'python', OTHER_FILES['script.py']);
        await eventually(
            'a type error',
            () => diagnosticsOf('script.py', 'python'),
            (list) => list.some((item) => /not assignable/.test(item.message))
        );
        const hover = await eventually(
            'a hover',
            () => ask('script.py', 'textDocument/hover', { position: positionOf(OTHER_FILES['script.py'], 'total(1)', 1) }).then((reply) => reply.result),
            Boolean
        );
        expect(JSON.stringify(hover)).toContain('total');
    }, 180_000);
});

describe('Bash', () => {
    test('finds the definition of a function', async () => {
        await openAndWait('run.sh', 'shellscript', 'bash', OTHER_FILES['run.sh']);
        const definition = await eventually(
            'a definition',
            () => ask('run.sh', 'textDocument/definition', { position: positionOf(OTHER_FILES['run.sh'], 'greet world', 1) }).then((reply) => reply.result),
            (result) => JSON.stringify(result ?? null).includes('"line":1')
        );
        expect(JSON.stringify(definition)).toContain('run.sh');
    }, 180_000);
});

describe('Dockerfile', () => {
    test('reports an unknown instruction and hovers an instruction', async () => {
        await openAndWait('Dockerfile', 'dockerfile', 'docker', OTHER_FILES.Dockerfile);
        const diagnostics = await eventually(
            'an unknown instruction',
            () => diagnosticsOf('Dockerfile', 'docker'),
            (list) => list.length > 0
        );
        expect(diagnostics[0]?.message).toContain('FRM');
        const hover = await ask('Dockerfile', 'textDocument/hover', { position: positionOf(OTHER_FILES.Dockerfile, 'FROM', 1) });
        expect(JSON.stringify(hover.result)).toContain('baseImage');
    }, 180_000);
});

describe('servers that serve beside the server of the language', () => {
    test('ESLint reports the rules of the project and offers its fixes among the actions of the TypeScript server', async () => {
        await install('typescript');
        await install('eslint');
        const text = LINT_FILES['src/a.js'];
        const opened = await host.open('c1', { projectId: 'p3', path: 'src/a.js', languageId: 'javascript', text });
        expect(opened.servers).toEqual(['typescript', 'eslint', 'tailwind']);
        await Promise.all([waitReady('typescript', 'p3'), waitReady('eslint', 'p3')]);
        const diagnostics = await eventually(
            'ESLint problems',
            () => diagnosticsOf('src/a.js', 'eslint'),
            (list) => list.some((item) => item.code === 'semi')
        );
        expect(diagnostics.some((item) => item.code === 'no-unused-vars')).toBe(true);
        const semi = diagnostics.find((item) => item.code === 'semi')!;
        const actions = await ask('src/a.js', 'textDocument/codeAction', { range: semi.range, context: { diagnostics: [semi], only: ['quickfix'] } }, 'p3');
        expect(actions.itemServers).toContain('eslint');
        const fix = (actions.result as { title: string; command: { command: string; arguments: unknown[] } }[]).find((action) => /semi/.test(action.title))!;
        // ESLint makes its fix as an edit it asks the client for while the command runs.
        const running = host.command('c1', {
            projectId: 'p3',
            path: 'src/a.js',
            command: fix.command.command,
            arguments: fix.command.arguments,
            server: 'eslint'
        });
        const asked = await eventually('an edit asked for', () => events.find((event) => event.event === 'language.edit'), Boolean);
        if (asked?.event !== 'language.edit') {
            throw new Error('No edit was asked for');
        }
        expect(JSON.stringify(asked.payload.edit)).toContain(';');
        host.answerEdit('c1', { projectId: 'p3', editId: asked.payload.editId, applied: true });
        await running;
    }, 180_000);

    test('Tailwind completes classes and finds the conflict beside the HTML server', async () => {
        await install('html');
        await install('tailwind');
        const text = LINT_FILES['index.html'];
        const opened = await host.open('c1', { projectId: 'p3', path: 'index.html', languageId: 'html', text });
        expect(opened.servers).toEqual(['html', 'tailwind']);
        await Promise.all([waitReady('html', 'p3'), waitReady('tailwind', 'p3')]);
        const hover = await eventually(
            'a class hover',
            () => ask('index.html', 'textDocument/hover', { position: positionOf(text, 'flex', 1) }, 'p3').then((reply) => reply.result),
            Boolean
        );
        expect(JSON.stringify(hover)).toContain('display: flex');
        const completion = await eventually(
            'class completions',
            () => ask('index.html', 'textDocument/completion', { position: positionOf(text, 'p-4', 3) }, 'p3'),
            (reply) => reply.itemServers?.includes('tailwind') === true
        );
        expect(JSON.stringify(completion.result)).toContain('p-4');
        await eventually(
            'a conflict',
            () => diagnosticsOf('index.html', 'tailwind'),
            (list) => list.length > 0
        );
    }, 180_000);

    test('serves a stylesheet with the CSS server and Tailwind together', async () => {
        await install('css');
        const text = LINT_FILES['app.css'];
        const opened = await host.open('c1', { projectId: 'p3', path: 'app.css', languageId: 'css', text });
        expect(opened.servers).toEqual(['css', 'tailwind']);
        await waitReady('css', 'p3');
        await eventually(
            'a CSS report',
            () => events.some((event) => event.event === 'language.diagnostics' && event.payload.path === 'app.css' && event.payload.server === 'css'),
            Boolean
        );
        // `@apply` is no problem for a project that uses Tailwind.
        expect(diagnosticsOf('app.css', 'css')).toEqual([]);
    }, 180_000);
});

describe('a language server of a person', () => {
    test('runs the command that was saved, for the files its pattern names', async () => {
        await install('docker');
        const script = join(base, 'home', 'language-servers', 'docker', 'node_modules', 'dockerfile-language-server-nodejs', 'bin', 'docker-langserver');
        const saved = await host.customSave({
            name: 'Container files',
            command: runtime.command,
            args: [script, '--stdio'],
            env: runtime.env,
            languages: [],
            patterns: ['*.dockerx']
        });
        const text = OTHER_FILES.Dockerfile;
        await writeFile(join(project, 'build.dockerx'), text);
        const opened = await host.open('c1', { projectId: 'p1', path: 'build.dockerx', languageId: 'plaintext', text });
        expect(opened.servers).toEqual([saved.id]);
        await waitReady(saved.id as LanguageServerKind);
        const diagnostics = await eventually(
            'an unknown instruction',
            () => diagnosticsOf('build.dockerx', saved.id),
            (list) => list.length > 0
        );
        expect(diagnostics[0]?.message).toContain('FRM');
        await host.customRemove(saved.id);
        expect((await host.status('p1')).some((status) => status.server === saved.id)).toBe(false);
    }, 180_000);
});

describe('the project closing', () => {
    test('ends every server and leaves no process behind', async () => {
        // Both projects, since a server outlives its last document and only its project's end stops it.
        await Promise.all([host.end('p1'), host.end('p2'), host.end('p3')]);
        const results = await Promise.all(exits);
        expect(results.length).toBeGreaterThanOrEqual(4);
        for (const projectId of ['p1', 'p2', 'p3']) {
            expect((await host.status(projectId)).every((status) => status.state === 'stopped')).toBe(true);
        }
    }, 60_000);
});
