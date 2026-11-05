import { afterEach, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { GrepError, grepFiles } from './grep.ts';
import { MachineHome } from './machine-home.ts';
import { forgetSearchCache } from './search.ts';
import * as searchable from './searchable.ts';

let root = '';

async function seed(): Promise<void> {
    await mkdir(join(root, 'src'), { recursive: true });
    await writeFile(
        join(root, 'src', 'session.ts'),
        ['import { spawn } from "bun";', '', 'export const startSession = (): void => {', '    spawn(["bash"]);', '};', ''].join('\n')
    );
    await writeFile(join(root, 'src', 'notes.md'), ['# Notes', '', 'A session is keyed by an id.', ''].join('\n'));
    await writeFile(join(root, 'src', 'unicode.ts'), ['const tree = "🌱 seedling";', 'const after = 1;', ''].join('\n'));
    await writeFile(join(root, 'src', 'binary.bin'), new Uint8Array([0, 115, 101, 115, 115, 105, 111, 110, 0]));
}

beforeEach(async () => {
    forgetSearchCache();
    root = await mkdtemp(join(tmpdir(), 'ruimte-grep-'));
    await seed();
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

/* A home without a dot under the folder searched, with its state beside the folders that stay open. */
async function homeInside(): Promise<MachineHome> {
    const home = join(root, 'machine');
    await mkdir(join(home, 'scratch'), { recursive: true });
    await mkdir(join(home, 'chats', 'c1.visuals'), { recursive: true });
    await mkdir(join(home, 'worktrees', 'w1'), { recursive: true });
    await writeFile(join(home, 'local.key'), 'session secret\n');
    await writeFile(join(home, 'chats', 'c1.jsonl'), 'session thread\n');
    await writeFile(join(home, 'scratch', 'notes.md'), 'session scratch\n');
    await writeFile(join(home, 'chats', 'c1.visuals', 'page.html'), 'session visual\n');
    await writeFile(join(home, 'worktrees', 'w1', 'a.ts'), 'session worktree\n');
    return new MachineHome(home);
}

/* Every path, line and context line a search hands out. */
function everything(result: { matches: Array<{ path: string; text: string; before: string[]; after: string[] }> }): string {
    return result.matches.map((match) => [match.path, match.text, ...match.before, ...match.after].join('\n')).join('\n');
}

async function expectHomeKept(home: MachineHome): Promise<void> {
    const result = await grepFiles(root, 'session', { policy: await home.policy() });
    const paths = result.matches.map((match) => match.path);
    expect(paths).toEqual(
        expect.arrayContaining(['machine/scratch/notes.md', 'machine/chats/c1.visuals/page.html', 'machine/worktrees/w1/a.ts', 'src/notes.md'])
    );
    expect(everything(result)).not.toContain('secret');
    expect(everything(result)).not.toContain('thread');
    expect(everything(result)).not.toContain('local.key');
}

/* A hit and the line above it, each with an emoji across the 500th and 501st unit, where a line is cut. */
async function longLines(): Promise<void> {
    await writeFile(join(root, 'src', 'long.ts'), [`${'c'.repeat(499)}😀 above`, `${'a'.repeat(499)}😀 needle`, ''].join('\n'));
}

describe('grepFiles', () => {
    test('finds a literal across files and reads the lines around it', async () => {
        const result = await grepFiles(root, 'session');
        const paths = result.matches.map((match) => match.path).sort();
        expect(paths).toContain('src/session.ts');
        expect(paths).toContain('src/notes.md');
        expect(paths).not.toContain('src/binary.bin');
        const hit = result.matches.find((match) => match.path === 'src/session.ts' && match.line === 3)!;
        expect(hit.text).toContain('startSession');
        expect(hit.before.at(-1)).toBe('');
        expect(hit.after[0]).toBe('    spawn(["bash"]);');
    });

    test('cuts a long line between two characters', async () => {
        await longLines();
        const [hit] = (await grepFiles(root, 'needle')).matches;
        expect(hit).toMatchObject({ text: 'a'.repeat(499), before: ['c'.repeat(499)] });
    });

    test('points at the hit inside the line, counted the way a viewer draws it', async () => {
        const result = await grepFiles(root, 'seedling');
        const hit = result.matches.find((match) => match.path === 'src/unicode.ts')!;
        expect(hit.text.slice(hit.column, hit.column + hit.length)).toBe('seedling');
    });

    test('a literal query is not read as a pattern', async () => {
        expect((await grepFiles(root, 'spawn(["bash"])')).matches).toHaveLength(1);
        expect((await grepFiles(root, 's.ssion')).matches).toHaveLength(0);
    });

    test('searches as a regular expression when asked', async () => {
        const result = await grepFiles(root, 'start[A-Z]\\w+', { regex: true, caseSensitive: true });
        expect(result.matches.map((match) => match.line)).toEqual([3]);
    });

    test('case and whole words narrow what answers', async () => {
        expect((await grepFiles(root, 'SESSION', { caseSensitive: true })).matches).toHaveLength(0);
        expect((await grepFiles(root, 'session', { wholeWord: true })).matches.map((match) => match.path)).toEqual(['src/notes.md']);
    });

    test('stops at the limit and says so', async () => {
        const result = await grepFiles(root, 'e', { limit: 2 });
        expect(result.matches).toHaveLength(2);
        expect(result.truncated).toBe(true);
    });

    test('an empty query asks nothing of the disk', async () => {
        const reads = spyOn(searchable, 'searchRoot');
        try {
            expect(await grepFiles(root, '   ')).toEqual({ matches: [], files: 0, truncated: false });
            expect(reads).not.toHaveBeenCalled();
        } finally {
            reads.mockRestore();
        }
    });

    test('a pattern that is no pattern comes back as an error the client can show', async () => {
        await expect(grepFiles(root, '(unclosed', { regex: true })).rejects.toThrow(GrepError);
    });

    test('a lookahead finds what it looks for', async () => {
        const result = await grepFiles(root, 'start(?=Session)', { regex: true, caseSensitive: true });
        expect(result.matches.map((match) => [match.path, match.line])).toEqual([['src/session.ts', 3]]);
    });

    test('a home below the folder searched gives nothing of its own state, and its open folders still answer', async () => {
        await expectHomeKept(await homeInside());
    });

    test('a link in the folder searched leads nowhere into the home', async () => {
        const home = await homeInside();
        const elsewhere = await mkdtemp(join(tmpdir(), 'ruimte-grep-project-'));
        try {
            await writeFile(join(elsewhere, 'own.md'), 'session own\n');
            await symlink(join(root, 'machine'), join(elsewhere, 'state'));
            await symlink(join(root, 'machine', 'local.key'), join(elsewhere, 'key.md'));
            const result = await grepFiles(elsewhere, 'session', { policy: await home.policy() });
            expect(result.matches.map((match) => match.path)).toEqual(['own.md']);
        } finally {
            await rm(elsewhere, { recursive: true, force: true });
        }
    });

    test.skipIf(Bun.which('rg') === null)('a pattern ripgrep turns away is refused, never searched another way', async () => {
        // `\8` is a backreference ripgrep refuses and JavaScript reads as a literal.
        await expect(grepFiles(root, 'session|\\8', { regex: true })).rejects.toThrow(GrepError);
    });

    test.skipIf(Bun.which('rg') === null)('reads the lines after the last hit of a file and no further', async () => {
        await writeFile(join(root, 'src', 'many.txt'), Array.from({ length: 5000 }, (_, index) => `needle ${index + 1}`).join('\n'));
        const result = await grepFiles(root, 'needle', { limit: 2 });
        expect(result.truncated).toBe(true);
        expect(result.matches.map((match) => [match.line, match.after])).toEqual([
            [1, ['needle 2', 'needle 3']],
            [2, ['needle 3', 'needle 4']]
        ]);
    });
});

/* The same searches without ripgrep on PATH. Git goes with it, so the file list comes from the
   walk, which is exactly the machine this fallback exists for. */
describe('grepFiles without ripgrep', () => {
    let path = '';

    beforeEach(() => {
        path = process.env.PATH ?? '';
        process.env.PATH = '';
    });

    afterEach(() => {
        process.env.PATH = path;
    });

    test('finds a literal and reads the lines around it', async () => {
        const result = await grepFiles(root, 'session');
        expect(result.matches.map((match) => match.path).sort()).toEqual(['src/notes.md', 'src/session.ts']);
        const hit = result.matches.find((match) => match.path === 'src/session.ts')!;
        expect(hit.line).toBe(3);
        expect(hit.after[0]).toBe('    spawn(["bash"]);');
    });

    test('honors case, whole words and the limit', async () => {
        expect((await grepFiles(root, 'SESSION', { caseSensitive: true })).matches).toHaveLength(0);
        expect((await grepFiles(root, 'session', { wholeWord: true })).matches.map((match) => match.path)).toEqual(['src/notes.md']);
        expect((await grepFiles(root, 'e', { limit: 2 })).truncated).toBe(true);
    });

    test('a search that runs out of time says so rather than hold the machine', async () => {
        const result = await grepFiles(root, 'e', {
            budget: (stop) => {
                stop();
                return () => undefined;
            }
        });
        expect(result).toEqual({ matches: [], files: 0, truncated: true });
    });

    test('a pattern that backtracks without end is stopped and the machine keeps answering', async () => {
        const trap = `${'a'.repeat(48)}b`;
        await writeFile(join(root, 'src', 'trap.txt'), `${trap}\n`);
        const probe = join(root, 'regex-probe.ts');
        await writeFile(
            probe,
            `
            const execute = RegExp.prototype.exec;
            RegExp.prototype.exec = function (text) {
                if (this.source === '^(a+)+$' && text === ${JSON.stringify(trap)}) {
                    postMessage({ probe: 'backtracking' });
                }
                return execute.call(this, text);
            };
        `
        );
        const NativeWorker = Worker;
        let stopSearch: (() => void) | undefined;
        let started = false;
        let canceled = false;
        const workers: Worker[] = [];
        globalThis.Worker = class extends NativeWorker {
            constructor(url: string | URL, options?: Bun.WorkerOptions) {
                // The real worker and search stay intact; only the regex entry is acknowledged before it blocks that thread.
                super(url, { ...options, preload: [probe] });
                workers.push(this);
                this.addEventListener('message', (event) => {
                    if ((event.data as { probe?: string }).probe === 'backtracking') {
                        event.stopImmediatePropagation();
                        started = true;
                        stopSearch!();
                    }
                });
            }
        };
        try {
            const result = await grepFiles(root, '^(a+)+$', {
                regex: true,
                budget: (stop) => {
                    stopSearch = stop;
                    return () => {
                        canceled = true;
                    };
                }
            });
            expect(started).toBe(true);
            expect(canceled).toBe(true);
            expect(result).toEqual({ matches: [], files: 0, truncated: true });
            expect((await grepFiles(root, 'seedling')).matches.map((match) => match.path)).toEqual(['src/unicode.ts']);
        } finally {
            for (const worker of workers) {
                worker.terminate();
            }
            globalThis.Worker = NativeWorker;
        }
    });

    test('never follows a link, to a file or to a folder', async () => {
        const secrets = await mkdtemp(join(tmpdir(), 'ruimte-grep-secret-'));
        try {
            await writeFile(join(secrets, 'key.txt'), 'session secret\n');
            await symlink(join(secrets, 'key.txt'), join(root, 'src', 'link.txt'));
            await symlink(secrets, join(root, 'linked'));
            const result = await grepFiles(root, 'secret');
            expect(result.matches).toEqual([]);
        } finally {
            await rm(secrets, { recursive: true, force: true });
        }
    });

    test('a whole word is whole in every script', async () => {
        await writeFile(join(root, 'src', 'cafe.md'), ['caféteria', 'een café', ''].join('\n'));
        const result = await grepFiles(root, 'café', { wholeWord: true });
        expect(result.matches.map((match) => match.text)).toEqual(['een café']);
    });

    test('cuts a long line between two characters', async () => {
        await longLines();
        const [hit] = (await grepFiles(root, 'needle')).matches;
        expect(hit).toMatchObject({ text: 'a'.repeat(499), before: ['c'.repeat(499)] });
    });
});
