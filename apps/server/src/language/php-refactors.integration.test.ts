import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync, readdirSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, realpath, rename, rm, stat, symlink, writeFile } from 'node:fs/promises';
import { homedir, tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { LanguageRequestResult } from '@ruimte/contracts';
import { applyTextEdits, fileUriToPath, type CodeAction, type Position, type WorkspaceEdit } from '@ruimte/smart-editor-lsp';
import { MachineHome } from '../fs/machine-home.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { LanguageHost } from './host.ts';
import { NativePolicy } from './native.ts';
import { spawnLanguageProcess } from './runtime.ts';

/*
 * The refactors of the PHP server of Ruimte through the host, on a small project written to a temporary folder. It runs the
 * server that is built already and the stubs that Install left in the development home, so nothing is built or downloaded here.
 */

const BINARY = resolve(import.meta.dir, '../../../php-language-server/target/release/php-language-server');
const STUBS_ROOT = join(process.env.RUIMTE_DEV_HOME ?? join(homedir(), '.ruimte-dev'), 'language-servers', 'php-native', 'storage', 'stubs');
const stubs = existsSync(STUBS_ROOT) ? readdirSync(STUBS_ROOT).find((commit) => existsSync(join(STUBS_ROOT, commit, '.complete'))) : undefined;
const runnable = existsSync(BINARY) && stubs !== undefined;

if (!runnable) {
    console.warn(`Skipping the PHP refactor tests: they need ${BINARY} and the stubs of an installed PHP server under ${STUBS_ROOT}`);
}

const FILES: Record<string, string> = {
    'composer.json': JSON.stringify({ name: 'acme/app', require: { php: '^8.1' }, autoload: { 'psr-4': { 'App\\': 'src/' } } }),
    'src/Models/User.php': [
        '<?php',
        '',
        'namespace App\\Models;',
        '',
        'class User',
        '{',
        '    public function name(): string',
        '    {',
        "        return 'Ada';",
        '    }',
        '}',
        ''
    ].join('\n'),
    'src/Domain/Order.php': ['<?php', '', 'namespace App\\Domain;', '', 'class Order', '{', '}', ''].join('\n'),
    'src/Services/Report.php': [
        '<?php',
        '',
        'namespace App\\Services;',
        '',
        'use App\\Models\\User;',
        '',
        'class Report',
        '{',
        '    public function owner(): User',
        '    {',
        '        return new User();',
        '    }',
        '}',
        ''
    ].join('\n'),
    'src/Services/Billing.php': [
        '<?php',
        '',
        'namespace App\\Services;',
        '',
        'use App\\Models\\User;',
        '',
        'class Billing',
        '{',
        '    public function label(User $user): string',
        '    {',
        "        $greeting = strtoupper($user->name()) . '!';",
        '',
        '        return $greeting;',
        '    }',
        '',
        '    public function check(bool $left): bool',
        '    {',
        "        return $left && strlen('x') > 0;",
        '    }',
        '}',
        ''
    ].join('\n')
};

let base = '';
let project = '';
let host: LanguageHost;
const events: SessionEvent[] = [];
const exits: Promise<unknown>[] = [];
const texts = new Map<string, string>();
const versions = new Map<string, number>();

async function eventually<T>(what: string, run: () => Promise<T> | T, accept: (value: T) => boolean = Boolean, timeoutMs = 60_000): Promise<T> {
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
    return { line: before.length - 1, character: before[before.length - 1]!.length };
}

const uriOf = (path: string): string => `file://${join(project, path)}`;

const ask = (path: string, method: string, params: unknown): Promise<LanguageRequestResult> =>
    host.request({ projectId: 'p1', path, method: method as never, params });

async function open(path: string): Promise<string> {
    const text = FILES[path]!;
    const opened = await host.open('c1', { projectId: 'p1', path, languageId: 'php', text });
    texts.set(path, text);
    versions.set(path, opened.version);
    return text;
}

/* The client's side of an edit the daemon hands over: an editor takes it, tells the daemon what changed, and says it made it. */
function makeEditor(): void {
    host.subscribe('c1', (event) => {
        events.push(event);
        if (event.event !== 'language.edit') {
            return;
        }
        const { editId, edit } = event.payload as { editId: string; edit: WorkspaceEdit };
        void (async () => {
            for (const change of edit.documentChanges ?? []) {
                if (!('textDocument' in change)) {
                    continue;
                }
                const path = fileUriToPath(change.textDocument.uri)!.slice(project.length + 1);
                const before = texts.get(path)!;
                const after = applyTextEdits(before, change.edits);
                texts.set(path, after);
                const result = await host.change({ projectId: 'p1', path, baseVersion: versions.get(path)!, changes: [{ text: after }] });
                versions.set(path, result.version);
            }
            host.answerEdit('c1', { projectId: 'p1', editId, applied: true });
        })();
    });
}

async function actionsAt(path: string, range: { start: Position; end: Position }, only: string[]): Promise<CodeAction[]> {
    const reply = await eventually(
        `${only.join(',')} actions in ${path}`,
        () => ask(path, 'textDocument/codeAction', { range, context: { diagnostics: [], only } }),
        (answer) => Array.isArray(answer.result) && answer.result.length > 0
    );
    return reply.result as CodeAction[];
}

describe.skipIf(!runnable)('the refactors of the PHP server of Ruimte', () => {
    beforeAll(async () => {
        base = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-php-refactors-')));
        project = join(base, 'project');
        for (const [path, text] of Object.entries(FILES)) {
            await mkdir(dirname(join(project, path)), { recursive: true });
            await writeFile(join(project, path), text);
        }
        // What Install leaves: the marker, the stubs, and a checkout whose build is the binary that is there already.
        const root = join(base, 'home', 'language-servers');
        const checkout = join(base, 'checkout');
        await mkdir(join(checkout, 'target', 'release'), { recursive: true });
        await symlink(BINARY, join(checkout, 'target', 'release', 'php-language-server'));
        await mkdir(join(root, 'php-native', 'storage', 'stubs'), { recursive: true });
        await symlink(join(STUBS_ROOT, stubs!), join(root, 'php-native', 'storage', 'stubs', stubs!));
        await writeFile(
            join(root, 'php-native', 'installed.json'),
            JSON.stringify({ versions: { 'php-language-server': '0.0.0-test' }, source: 'dev', stubs, installedAt: 1 })
        );
        host = new LanguageHost({
            root,
            folderOf: (projectId) => (projectId === 'p1' ? project : null),
            holders: () => ['c1'],
            machineHome: new MachineHome(join(base, 'home')),
            native: new NativePolicy({ checkout: { folder: checkout, version: '0.0.0-test', stubsCommit: stubs! } }),
            spawn: (spec) => {
                const child = spawnLanguageProcess(spec);
                exits.push(child.exited);
                return child;
            }
        });
        makeEditor();
        const billing = await open('src/Services/Billing.php');
        await eventually(
            'the server ready',
            async () => (await host.status('p1')).find((status) => status.server === 'php-native')?.state,
            (state) => state === 'ready'
        );
        await eventually(
            'the index of the project',
            () => ask('src/Services/Billing.php', 'textDocument/hover', { position: positionOf(billing, 'User $user', 1) }),
            (reply) => reply.result !== null
        );
    }, 120_000);

    afterAll(async () => {
        await host?.close();
        await Promise.all(exits);
        await rm(base, { recursive: true, force: true });
    });

    test('extract variable offers the rename of the name it wrote, at the place the name has in the new text', async () => {
        const path = 'src/Services/Billing.php';
        const text = texts.get(path)!;
        const start = positionOf(text, 'strtoupper');
        const end = positionOf(text, 'strtoupper($user->name())', 'strtoupper($user->name())'.length);
        const actions = await actionsAt(path, { start, end }, ['refactor.extract']);
        const extract = actions.find((action) => action.title === 'Extract variable');
        expect(extract, JSON.stringify(actions.map((action) => action.title))).toBeDefined();
        const resolved = (await ask(path, 'codeAction/resolve', extract)).result as CodeAction;
        const edit = resolved.edit!;
        const change = edit.documentChanges!.find((candidate) => 'textDocument' in candidate)!;
        const after = applyTextEdits(text, 'edits' in change ? change.edits : []);
        expect(resolved.command?.command).toBe('php.rename');
        const { position } = (resolved.command!.arguments as Array<{ position: Position }>)[0]!;
        const line = after.split('\n')[position.line]!;
        // On the name after its `$`, where the rename of a variable starts.
        expect(line.slice(position.character - 1)).toMatch(/^\$[A-Za-z]+ = strtoupper/);
        // The server answers the command itself with nothing, since the client starts the rename.
        const ran = await host.command('c1', { projectId: 'p1', path, command: 'php.rename', arguments: resolved.command!.arguments });
        expect(ran.result).toBeNull();
    });

    test('a refactor the server refuses says why', async () => {
        const path = 'src/Services/Billing.php';
        const text = texts.get(path)!;
        const start = positionOf(text, "strlen('x')");
        const end = positionOf(text, "strlen('x') > 0", "strlen('x') > 0".length);
        const actions = await actionsAt(path, { start, end }, ['refactor.extract']);
        const extract = actions.find((action) => action.title === 'Extract variable')!;
        await expect(ask(path, 'codeAction/resolve', extract)).rejects.toMatchObject({
            code: 'language-failed',
            message: 'The expression only runs when the left side allows it'
        });
    });

    test('move class moves the file in the same edit that updates the namespace and the references', async () => {
        const path = 'src/Models/User.php';
        await open(path);
        const text = texts.get(path)!;
        const at = positionOf(text, 'class User', 'class '.length + 1);
        const actions = await actionsAt(path, { start: at, end: at }, ['refactor.move']);
        const move = actions.find((action) => action.title === 'Move class to namespace App\\Domain');
        expect(move, JSON.stringify(actions.map((action) => action.title))).toBeDefined();
        const resolved = (await ask(path, 'codeAction/resolve', move)).result as CodeAction;
        const changes = resolved.edit!.documentChanges!;
        expect(changes.find((change) => 'kind' in change)).toMatchObject({ kind: 'rename', oldUri: uriOf(path), newUri: uriOf('src/Domain/User.php') });
        const billing = changes.find((change) => 'textDocument' in change && change.textDocument.uri === uriOf('src/Services/Billing.php'));
        const updated = applyTextEdits(FILES['src/Services/Billing.php']!, billing && 'edits' in billing ? billing.edits : []);
        expect(updated).toContain('use App\\Domain\\User;');
        expect(changes.findLastIndex((change) => 'textDocument' in change)).toBeLessThan(changes.findIndex((change) => 'kind' in change));
        await host.closeDocument('c1', { projectId: 'p1', path });
    });

    test('renaming a file in the tree brings its namespace and the references along before the file moves', async () => {
        const order: string[] = [];
        const edited = await host.renameFiles('c1', 'p1', join(project, 'src/Models/User.php'), join(project, 'src/Domain/User.php'), true, {
            move: async () => {
                order.push('move');
                await mkdir(join(project, 'src/Domain'), { recursive: true });
                await rename(join(project, 'src/Models/User.php'), join(project, 'src/Domain/User.php'));
            },
            write: async (path, text) => {
                order.push(`write ${path.slice(project.length + 1)}`);
                await writeFile(path, text);
            }
        });
        expect(edited.map((path) => path.slice(project.length + 1)).sort()).toEqual([
            'src/Models/User.php',
            'src/Services/Billing.php',
            'src/Services/Report.php'
        ]);
        expect(order.at(-1)).toBe('move');
        expect(order.slice(0, -1).sort()).toEqual(['write src/Models/User.php', 'write src/Services/Report.php']);
        expect(await readFile(join(project, 'src/Domain/User.php'), 'utf8')).toContain('namespace App\\Domain;');
        expect(await readFile(join(project, 'src/Services/Report.php'), 'utf8')).toContain('use App\\Domain\\User;');
        expect((await stat(join(project, 'src/Models/User.php')).catch(() => null)) === null).toBe(true);
        // Billing is open in an editor, which took the edit instead of the file being written.
        expect(texts.get('src/Services/Billing.php')).toContain('use App\\Domain\\User;');
        expect(await readFile(join(project, 'src/Services/Billing.php'), 'utf8')).toBe(FILES['src/Services/Billing.php']!);
    });
});
