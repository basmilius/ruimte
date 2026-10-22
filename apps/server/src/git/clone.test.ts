import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { cloneRepository, isRemoteUrl } from './clone.ts';
import type { streamCommand } from './run.ts';

let parent: string;
let progress: string[];

beforeEach(async () => {
    parent = await mkdtemp(join(tmpdir(), 'ruimte-clone-'));
    progress = [];
});

afterEach(async () => {
    await rm(parent, { recursive: true, force: true });
});

/* A git that makes the folder it was asked for, writes a line, and ends with `code`. */
function fakeGit(code: number, asked: string[][] = []): typeof streamCommand {
    return async (_command, args, cwd, options = {}) => {
        asked.push(args);
        await mkdir(join(cwd, args.at(-1)!, '.git'), { recursive: true });
        options.onLine?.('Receiving objects:  50% (1/2)');
        return { code, stdout: '', stderr: code === 0 ? "Cloning into 'app'..." : 'fatal: repository not found' };
    };
}

const job = { hold: () => undefined, canceled: false };

function clone(path: string, run: typeof streamCommand, url = 'git@github.com:basmilius/app.git') {
    return cloneRepository({ url, path, job, run, onProgress: (phase, line) => progress.push(`${phase}${line === '' ? '' : ` ${line}`}`) });
}

describe('cloning a repository', () => {
    test('takes only the URL of a remote', () => {
        expect(
            ['https://github.com/basmilius/app.git', 'git@github.com:basmilius/app.git', 'ssh://git@host:22/app.git', 'git://host/app'].every(isRemoteUrl)
        ).toBe(true);
        expect(['/Users/bas/app', 'file:///tmp/app', 'ext::sh -c touch% /tmp/x', '--upload-pack=touch', '../app'].some(isRemoteUrl)).toBe(false);
    });

    test('clones into the named folder under its parent, with the progress as it runs', async () => {
        const asked: string[][] = [];
        const result = await clone(join(parent, 'app'), fakeGit(0, asked));
        expect(result.path).toBe(join(parent, 'app'));
        expect(asked).toEqual([['clone', '--progress', '--', 'git@github.com:basmilius/app.git', 'app']]);
        expect(progress).toEqual(['fetch', 'fetch Receiving objects:  50% (1/2)', `done Cloned into ${join(parent, 'app')}`]);
    });

    test('a clone that fails leaves no folder behind, and an empty folder that was there stays', async () => {
        await expect(clone(join(parent, 'app'), fakeGit(128))).rejects.toThrow('fatal: repository not found');
        expect(await readdir(parent)).toEqual([]);
        await mkdir(join(parent, 'kept'));
        await expect(clone(join(parent, 'kept'), fakeGit(128))).rejects.toThrow();
        expect(await readdir(parent)).toEqual(['kept']);
        expect(await readdir(join(parent, 'kept'))).toEqual([]);
    });

    test('a folder with something in it, a missing parent, a relative path or a local URL is refused before git runs', async () => {
        const asked: string[][] = [];
        await mkdir(join(parent, 'taken'));
        await writeFile(join(parent, 'taken', 'file'), '');
        await expect(clone(join(parent, 'taken'), fakeGit(0, asked))).rejects.toMatchObject({ code: 'clone-refused' });
        await expect(clone(join(parent, 'missing', 'app'), fakeGit(0, asked))).rejects.toMatchObject({ code: 'folder-missing' });
        await expect(clone('app', fakeGit(0, asked))).rejects.toMatchObject({ code: 'clone-refused' });
        await expect(clone(join(parent, 'app'), fakeGit(0, asked), '/tmp/elsewhere')).rejects.toMatchObject({ code: 'clone-refused' });
        expect(asked).toEqual([]);
    });

    test('a canceled clone says so and leaves nothing', async () => {
        const canceled = { hold: () => undefined, canceled: true };
        await expect(
            cloneRepository({
                url: 'https://github.com/basmilius/app.git',
                path: join(parent, 'app'),
                job: canceled,
                run: fakeGit(143),
                onProgress: () => undefined
            })
        ).rejects.toThrow('The clone was canceled.');
        expect(await readdir(parent)).toEqual([]);
    });
});
