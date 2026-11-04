import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { gitIn } from '../git/test-repo.ts';
import { listDirectory } from './list.ts';

let root: string;

function names(entries: { name: string }[]): string[] {
    return entries.map((entry) => entry.name);
}

beforeEach(async () => {
    root = await mkdtemp(join(process.env.RUIMTE_INTEGRATION_FIXTURE_ROOT ?? tmpdir(), 'ruimte-list-'));
    await mkdir(join(root, 'assets'));
    await writeFile(join(root, 'item10.txt'), 'ten');
    await writeFile(join(root, 'item2.txt'), 'two');
    await writeFile(join(root, '.env'), 'secret');
    await gitIn(root, ['init', '--quiet']);
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('listDirectory in a repository', () => {
    test('flags what git ignores', async () => {
        await writeFile(join(root, '.gitignore'), 'assets/\n*.txt\n');
        const result = await listDirectory(root, { hidden: true });
        const ignored = new Set(result.entries.filter((entry) => entry.ignored).map((entry) => entry.name));
        expect(ignored).toEqual(new Set(['assets', 'item2.txt', 'item10.txt']));
        expect(names(result.entries)).not.toContain('.git');
    });

    test('a dot the repository keeps is listed like any other name', async () => {
        await mkdir(join(root, '.github'));
        await writeFile(join(root, '.editorconfig'), 'root = true\n');
        await writeFile(join(root, '.gitignore'), 'assets/\n.env\n');
        const listed = names((await listDirectory(root)).entries);
        expect(listed).toContain('.github');
        expect(listed).toContain('.editorconfig');
        expect(listed).not.toContain('.env');
        expect(listed).not.toContain('assets');
        expect(listed).not.toContain('.git');
    });

    test('a checkout under the folder answers about itself, not the one above it', async () => {
        await writeFile(join(root, '.gitignore'), 'notes/\n');
        const sub = join(root, 'sub');
        await mkdir(join(sub, 'notes'), { recursive: true });
        await writeFile(join(sub, 'notes', 'kept.md'), 'kept');
        await gitIn(sub, ['init', '--quiet']);
        await mkdir(join(root, 'notes'));
        await writeFile(join(root, 'notes', 'gone.md'), 'gone');

        const result = await listDirectory(root, { depth: 2 });
        expect(names(result.entries)).not.toContain('gone.md');
        expect(result.entries.find((entry) => entry.name === 'notes' && entry.path.startsWith(sub))!.ignored).toBe(false);
    });
});
