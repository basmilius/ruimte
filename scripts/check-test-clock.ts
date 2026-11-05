import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, Visitor, type Expression, type Super } from 'oxc-parser';

/*
 * No test in the default run depends on wall-clock time or starts a process. oxlint has no rule that
 * catches a `new Date()` without arguments and lets a fake clock's own setup through, and its JS plugins
 * are still alpha, so this walks the syntax itself. An integration test (`*.integration.test.ts`) may
 * read the real clock and start real processes.
 */

const ROOT = fileURLToPath(new URL('../', import.meta.url));

const READS: Record<string, string> = { Date: 'now', performance: 'now', process: 'hrtime' };

// What a fake clock or a fixed system time is set up with may start from the clock it replaces.
const SETUPS = new Set(['setSystemTime', 'useFakeTimers']);

function calleeName(callee: Expression | Super): string | null {
    if (callee.type === 'Identifier') {
        return callee.name;
    }
    if (callee.type === 'MemberExpression' && !callee.computed && callee.property.type === 'Identifier') {
        return callee.property.name;
    }
    return null;
}

function isSetup(callee: Expression | Super): boolean {
    const name = calleeName(callee);
    return name !== null && (SETUPS.has(name) || /clock$/i.test(name));
}

export interface ClockRead {
    line: number;
    what: string;
}

/* Every read of the wall clock in a test file, outside the arguments of a fake-clock setup. */
export function clockReads(path: string, text: string): ClockRead[] {
    const program = parseSync(path, text).program;
    const exempt: Array<[number, number]> = [];
    const found: Array<{ start: number; what: string }> = [];
    const noteSetup = (node: { callee: Expression | Super; arguments: ReadonlyArray<{ start: number; end: number }> }): void => {
        if (isSetup(node.callee)) {
            for (const argument of node.arguments) {
                exempt.push([argument.start, argument.end]);
            }
        }
    };
    new Visitor({
        CallExpression(node) {
            noteSetup(node);
            if (node.callee.type === 'Identifier' && node.callee.name === 'Date') {
                found.push({ start: node.start, what: 'Date()' });
            }
        },
        NewExpression(node) {
            noteSetup(node);
            if (node.callee.type === 'Identifier' && node.callee.name === 'Date' && node.arguments.length === 0) {
                found.push({ start: node.start, what: 'new Date()' });
            }
        },
        MemberExpression(node) {
            if (node.computed || node.object.type !== 'Identifier' || node.property.type !== 'Identifier') {
                return;
            }
            if (READS[node.object.name] === node.property.name) {
                found.push({ start: node.start, what: `${node.object.name}.${node.property.name}` });
            }
        }
    }).visit(program);
    const lineOf = (start: number): number => text.slice(0, start).split('\n').length;
    return found
        .filter(({ start }) => !exempt.some(([from, to]) => start >= from && start < to))
        .map(({ start, what }) => ({ line: lineOf(start), what }))
        .sort((left, right) => left.line - right.line);
}

const TIMERS = new Set(['setTimeout', 'setInterval']);

function isPositiveNumber(node: { type: string; value?: unknown } | undefined): boolean {
    return node?.type === 'Literal' && typeof node.value === 'number' && node.value > 0;
}

export interface TimerWait {
    line: number;
    what: string;
}

/*
 * Every timer a test file waits out on the real clock: a literal delay above zero. A zero delay is a turn
 * of the event loop, and a file that sets up fake timers runs its timers on them.
 */
export function timerWaits(path: string, text: string): TimerWait[] {
    const program = parseSync(path, text).program;
    const found: Array<{ start: number; what: string }> = [];
    let faked = false;
    const sleeps = new Set<string>();

    new Visitor({
        ImportDeclaration(node) {
            if (node.source.value !== 'bun' || node.importKind === 'type') {
                return;
            }

            for (const specifier of node.specifiers) {
                if (specifier.type === 'ImportSpecifier' && specifier.imported.type === 'Identifier' && specifier.imported.name === 'sleep') {
                    sleeps.add(specifier.local.name);
                }
            }
        },
        CallExpression(node) {
            const name = calleeName(node.callee);

            if (name === 'useFakeTimers') {
                faked = true;
                return;
            }

            if (name !== null && TIMERS.has(name) && isPositiveNumber(node.arguments[1])) {
                found.push({ start: node.start, what: `${name} of ${String((node.arguments[1] as { value: number }).value)} ms` });
                return;
            }

            const bunSleep =
                node.callee.type === 'MemberExpression' &&
                !node.callee.computed &&
                node.callee.object.type === 'Identifier' &&
                node.callee.object.name === 'Bun' &&
                node.callee.property.type === 'Identifier' &&
                node.callee.property.name === 'sleep';

            if ((bunSleep || (node.callee.type === 'Identifier' && sleeps.has(node.callee.name))) && isPositiveNumber(node.arguments[0])) {
                found.push({ start: node.start, what: `sleep of ${String((node.arguments[0] as { value: number }).value)} ms` });
            }
        }
    }).visit(program);

    if (faked) {
        return [];
    }

    const lineOf = (start: number): number => text.slice(0, start).split('\n').length;

    return found.map(({ start, what }) => ({ line: lineOf(start), what })).sort((left, right) => left.line - right.line);
}

const PROCESS_MODULES = new Set(['child_process', 'node:child_process']);

// The git fixture helpers start git for the test, out of sight of the file that imports them.
const PROCESS_HELPERS = /(^|\/)test-repo(\.ts)?$/;

// What `bun` exports that starts a process: `$` runs a real shell.
const BUN_STARTERS = new Set(['spawn', 'spawnSync', '$']);

export interface ProcessStart {
    line: number;
    what: string;
}

/* Every place a test file starts a process itself: `Bun.spawn`, Bun's shell, `node:child_process` or the git fixtures. */
export function processStarts(path: string, text: string): ProcessStart[] {
    const program = parseSync(path, text).program;
    const found: Array<{ start: number; what: string }> = [];
    const noteModule = (start: number, source: string): void => {
        if (PROCESS_MODULES.has(source) || PROCESS_HELPERS.test(source)) {
            found.push({ start, what: source });
        }
    };

    new Visitor({
        ImportDeclaration(node) {
            if (node.importKind === 'type') {
                return;
            }

            noteModule(node.start, node.source.value);

            if (node.source.value !== 'bun') {
                return;
            }

            for (const specifier of node.specifiers) {
                if (specifier.type === 'ImportSpecifier' && specifier.importKind !== 'type' && specifier.imported.type === 'Identifier') {
                    if (BUN_STARTERS.has(specifier.imported.name)) {
                        found.push({ start: specifier.start, what: `${specifier.imported.name} from bun` });
                    }
                }
            }
        },
        ImportExpression(node) {
            if (node.source.type === 'Literal' && typeof node.source.value === 'string') {
                noteModule(node.start, node.source.value);
            }
        },
        CallExpression(node) {
            const [argument] = node.arguments;

            if (node.callee.type === 'Identifier' && node.callee.name === 'require' && argument?.type === 'Literal' && typeof argument.value === 'string') {
                noteModule(node.start, argument.value);
            }
        },
        MemberExpression(node) {
            if (node.computed || node.object.type !== 'Identifier' || node.object.name !== 'Bun' || node.property.type !== 'Identifier') {
                return;
            }

            if (node.property.name === 'spawn' || node.property.name === 'spawnSync' || node.property.name === '$') {
                found.push({ start: node.start, what: `Bun.${node.property.name}` });
            }
        }
    }).visit(program);

    const lineOf = (start: number): number => text.slice(0, start).split('\n').length;

    return found.map(({ start, what }) => ({ line: lineOf(start), what })).sort((left, right) => left.line - right.line);
}

function testFiles(): string[] {
    const listed = Bun.spawnSync(['git', 'ls-files', '--cached', '--others', '--exclude-standard', '-z', '--', '*.test.ts', '*.test.tsx'], { cwd: ROOT });
    if (listed.exitCode !== 0) {
        throw new Error(`git ls-files failed: ${listed.stderr.toString()}`);
    }
    return listed.stdout
        .toString()
        .split('\0')
        .filter((path) => path !== '' && !/\.integration\.test\.tsx?$/.test(path) && existsSync(join(ROOT, path)))
        .sort();
}

if (import.meta.main) {
    const problems: string[] = [];
    for (const path of testFiles()) {
        const text = readFileSync(join(ROOT, path), 'utf8');
        for (const read of clockReads(path, text)) {
            problems.push(`${path}:${read.line}: ${read.what} reads the wall clock; use a fixed epoch or a fake clock`);
        }
        for (const wait of timerWaits(path, text)) {
            problems.push(`${path}:${wait.line}: ${wait.what} waits on the wall clock; use fake timers or wait for what the test expects`);
        }
        for (const started of processStarts(path, text)) {
            problems.push(`${path}:${started.line}: ${started.what} starts a process; use a fake or move the test to an *.integration.test.ts`);
        }
    }
    for (const problem of problems) {
        console.error(problem);
    }
    process.exitCode = problems.length === 0 ? 0 : 1;
}
