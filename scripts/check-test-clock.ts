import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseSync, Visitor, type Expression, type Super } from 'oxc-parser';

/*
 * No test in the default run depends on wall-clock time. oxlint has no rule that catches a `new Date()`
 * without arguments and lets a fake clock's own setup through, and its JS plugins are still alpha, so
 * this walks the syntax itself. An integration test (`*.integration.test.ts`) may read the real clock.
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
        .sort((a, b) => a.line - b.line);
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
        for (const read of clockReads(path, readFileSync(join(ROOT, path), 'utf8'))) {
            problems.push(`${path}:${read.line}: ${read.what} reads the wall clock; use a fixed epoch or a fake clock`);
        }
    }
    for (const problem of problems) {
        console.error(problem);
    }
    process.exitCode = problems.length === 0 ? 0 : 1;
}
