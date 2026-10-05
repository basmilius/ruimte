import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import type { LanguageRequestResult } from '@ruimte/contracts';
import type { Diagnostic, Position } from '@ruimte/smart-editor-lsp';
import { MachineHome } from '../fs/machine-home.ts';
import type { SessionEvent } from '../sessions/manager.ts';
import { LanguageHost } from './host.ts';
import { cargoCommand, NativePolicy, readNativeCheckout, type Download } from './native.ts';
import { spawnLanguageProcess } from './runtime.ts';
import { tarGz } from './test-archives.ts';

/*
 * The PHP server of Ruimte, built from the checkout with cargo the way Install does in development
 * and run through the host. The stubs come from a small archive of the test's own, so the run needs no network.
 */

const CHECKOUT = resolve(import.meta.dir, '../../../php-language-server');
const checkout = readNativeCheckout(CHECKOUT);
const hasCargo = existsSync(cargoCommand());

if (!hasCargo || checkout === null) {
    console.warn(`Skipping the PHP server tests: ${checkout === null ? `${CHECKOUT} is not a checkout of the server` : 'cargo is not installed'}`);
}

const STUBS = tarGz([
    {
        path: 'stubs/standard/standard_0.php',
        text: '<?php\n\n/**\n * Counts the bytes of a string.\n * @param string $string\n * @return int\n */\nfunction strlen(string $string): int {}\n'
    }
]);

const FILES: Record<string, string> = {
    'composer.json': JSON.stringify({ name: 'acme/app', require: { php: '^8.1' }, autoload: { 'psr-4': { 'Acme\\': 'src/' } } }),
    'src/Greeter.php': [
        '<?php',
        '',
        'namespace Acme;',
        '',
        '/** Says hello to someone. */',
        'final class Greeter',
        '{',
        '    /** Builds the greeting for a name. */',
        '    public function greet(string $name): string',
        '    {',
        "        return 'Hello, ' . $name;",
        '    }',
        '',
        '    public function shout(string $name): string',
        '    {',
        '        return strtoupper($this->greet($name));',
        '    }',
        '}',
        ''
    ].join('\n'),
    'main.php': [
        '<?php',
        '',
        'use Acme\\Greeter;',
        '',
        '$greeter = new Greeter();',
        "echo $greeter->greet('Ada');",
        'echo strlen("abc");',
        '$greeter->',
        ''
    ].join('\n')
};

let base = '';
let project = '';
let host: LanguageHost;
const events: SessionEvent[] = [];
const exits: Promise<unknown>[] = [];

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

const ask = (path: string, method: string, params: unknown): Promise<LanguageRequestResult> =>
    host.request({ projectId: 'p1', path, method: method as never, params });

function diagnosticsOf(path: string): Diagnostic[] {
    const report = events.findLast((event) => event.event === 'language.diagnostics' && event.payload.path === path);
    return report && report.event === 'language.diagnostics' ? (report.payload.diagnostics as Diagnostic[]) : [];
}

const download: Download = async (_url, destination) => {
    await writeFile(destination, STUBS);
};

describe.skipIf(!hasCargo || checkout === null)('the PHP server of Ruimte', () => {
    beforeAll(async () => {
        base = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-php-server-')));
        project = join(base, 'project');
        for (const [path, text] of Object.entries(FILES)) {
            await mkdir(join(project, path, '..'), { recursive: true });
            await writeFile(join(project, path), text);
        }
        host = new LanguageHost({
            root: join(base, 'home', 'language-servers'),
            folderOf: (projectId) => (projectId === 'p1' ? project : null),
            holders: () => ['c1'],
            machineHome: new MachineHome(join(base, 'home')),
            native: new NativePolicy({ checkout }),
            download,
            spawn: (spec) => {
                const child = spawnLanguageProcess(spec);
                exits.push(child.exited);
                return child;
            }
        });
        host.subscribe('c1', (event) => events.push(event));
    }, 600_000);

    afterAll(async () => {
        await host?.close();
        await Promise.all(exits);
        await rm(base, { recursive: true, force: true });
    });

    test('Install builds the checkout, fetches the stubs and leaves the kind installed', async () => {
        await host.install('php-native');
        await eventually(
            'the install',
            async () => (await host.status('p1')).find((status) => status.server === 'php-native'),
            (status) => status?.state === 'stopped' || (status?.state === 'not-installed' && status.message !== undefined),
            600_000
        );
        const status = (await host.status('p1')).find((candidate) => candidate.server === 'php-native');
        const log = (await host.log('p1', 'php-native')).map((line) => line.text).join('\n');
        expect({ state: status?.state, message: status?.message, log }).toMatchObject({ state: 'stopped' });
        expect(status).toMatchObject({ version: checkout!.version, chosen: true });
    }, 600_000);

    test('answers hover, completion and diagnostics on a project of its own', async () => {
        const text = FILES['main.php']!;
        const opened = await host.open('c1', { projectId: 'p1', path: 'main.php', languageId: 'php', text });
        expect(opened.servers).toEqual(['php-native']);
        await eventually(
            'the server ready',
            async () => (await host.status('p1')).find((status) => status.server === 'php-native')?.state,
            (state) => state === 'ready'
        );

        const hover = await eventually(
            'a hover on a class of the project',
            () => ask('main.php', 'textDocument/hover', { position: positionOf(text, 'Greeter()', 2) }),
            (reply) => reply.result !== null,
            60_000
        );
        expect(JSON.stringify(hover.result)).toContain('Greeter');

        const library = await eventually(
            'a hover on a function of the standard library',
            () => ask('main.php', 'textDocument/hover', { position: positionOf(text, 'strlen', 2) }),
            (reply) => JSON.stringify(reply.result).includes('Counts the bytes')
        );
        expect(JSON.stringify(library.result)).toContain('strlen');

        const members = await eventually(
            'the members of the greeter',
            () => ask('main.php', 'textDocument/completion', { position: positionOf(text, '$greeter->\n', '$greeter->'.length) }),
            (reply) => JSON.stringify(reply.result).includes('shout')
        );
        expect(JSON.stringify(members.result)).toContain('greet');

        const end = { line: 8, character: 0 };
        await host.change({ projectId: 'p1', path: 'main.php', baseVersion: opened.version, changes: [{ range: { start: end, end }, text: 'if (\n' }] });
        const problems = await eventually(
            'a syntax error',
            () => diagnosticsOf('main.php'),
            (list) => list.length > 0
        );
        expect(problems.some((item) => item.severity === 1)).toBe(true);
    }, 180_000);
});
