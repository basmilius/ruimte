import { beforeEach, describe, expect, test } from 'bun:test';
import { cp, mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { renameNoReplace } from '../disk/no-replace-rename.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { copyWithoutReplacing, moveOwnFiles, ownFolderOf, type OwnFilesIO } from './own-files.ts';

let root: string;
let from: string;
let to: string;

const newHome = tempHomes('ruimte-own-files-');

beforeEach(async () => {
    root = await newHome();
    from = join(root, 'scratch', 'chat-1');
    to = join(root, 'vinyl');
    await mkdir(join(from, 'sketches'), { recursive: true });
    await mkdir(to);
    await writeFile(join(from, 'notes.md'), 'notes');
    await writeFile(join(from, '.env'), 'secret');
    await writeFile(join(from, 'sketches', 'a.txt'), 'sketch');
});

function error(code: string): Error {
    return Object.assign(new Error(code), { code });
}

const copyIO: OwnFilesIO['copy'] = (source, target) => cp(source, target, { recursive: true, errorOnExist: true, force: false });

async function names(folder: string): Promise<string[]> {
    return (await readdir(folder).catch(() => [])).sort();
}

describe('ownFolderOf', () => {
    test('is the folder of a chat id in the scratch folder', () => {
        expect(ownFolderOf('/home/.ruimte/scratch', 'chat-1')).toBe(join('/home/.ruimte/scratch', 'chat-1'));
    });

    test('refuses an id that is more than one name', () => {
        for (const chatId of ['..', '../..', '../../etc', 'a/b', 'a\\b', '', '.']) {
            expect(() => ownFolderOf('/home/.ruimte/scratch', chatId)).toThrow(expect.objectContaining({ code: 'chat-not-found' }));
        }
    });
});

describe('moveOwnFiles', () => {
    test('moves every top-level entry, hidden ones included, and removes the emptied folder', async () => {
        const result = await moveOwnFiles(from, to);
        expect(result.moved).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await readFile(join(to, 'sketches', 'a.txt'), 'utf8')).toBe('sketch');
        expect(await names(from)).toEqual([]);
        await expect(readdir(from)).rejects.toThrow();
    });

    test('puts everything back on undo, and a second undo does nothing', async () => {
        const result = await moveOwnFiles(from, to);
        await result.undo();
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
        await result.undo();
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
    });

    test('refuses a taken name before anything moved', async () => {
        await writeFile(join(to, 'notes.md'), 'other');
        await expect(moveOwnFiles(from, to)).rejects.toMatchObject({ code: 'files-conflict', message: expect.stringContaining('notes.md') });
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await readFile(join(to, 'notes.md'), 'utf8')).toBe('other');
    });

    test('puts back what moved when a name is taken in the meantime', async () => {
        let calls = 0;
        const io: OwnFilesIO = {
            rename: async (source, target) => {
                calls += 1;
                if (calls === 2) {
                    throw error('EEXIST');
                }
                await renameNoReplace(source, target);
            },
            copy: copyIO
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({ code: 'files-conflict' });
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
    });

    test('refuses a file system that cannot move without replacing, and never falls back to a replacing move', async () => {
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('ENOTSUP');
            },
            copy: copyIO
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({ code: 'move-failed' });
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
    });

    test('copies across a volume and deletes the originals only after every copy succeeded', async () => {
        const copies: string[] = [];
        let moving = true;
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('EXDEV');
            },
            copy: async (source, target) => {
                if (moving) {
                    // Every original is still there while the copies are made.
                    expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
                    copies.push(target);
                }
                await copyIO(source, target);
            }
        };
        const result = await moveOwnFiles(from, to, io);
        moving = false;
        expect(copies).toHaveLength(3);
        expect(result.moved).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual(['.env', 'notes.md', 'sketches']);
        await expect(readdir(from)).rejects.toThrow();
        await result.undo();
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
    });

    test('keeps the originals and removes only its own copies when a copy fails', async () => {
        let calls = 0;
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('EXDEV');
            },
            copy: async (source, target) => {
                calls += 1;
                if (calls === 3) {
                    throw error('EIO');
                }
                await copyIO(source, target);
            }
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({ code: 'move-failed' });
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await names(to)).toEqual([]);
    });

    test('names the folder that holds the whole copy when an original cannot be deleted', async () => {
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('EXDEV');
            },
            copy: copyIO,
            remove: async (path) => {
                if (path.endsWith('notes.md')) {
                    throw error('EACCES');
                }
                await rm(path, { recursive: true, force: true });
            }
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({
            code: 'move-failed',
            message: expect.stringContaining(`The whole copy is in ${join(to, 'notes.md')}`)
        });
        // The copy of the entry that could not be deleted stays; the one before it was put back.
        expect(await names(to)).toEqual(['notes.md']);
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
    });

    test('does not remove a name it did not make when a copy finds it taken', async () => {
        let calls = 0;
        const io: OwnFilesIO = {
            rename: async () => {
                throw error('EXDEV');
            },
            copy: async (source, target) => {
                calls += 1;
                if (calls === 2) {
                    await writeFile(target, 'someone else');
                    throw error('ERR_FS_CP_EEXIST');
                }
                await copyIO(source, target);
            }
        };
        await expect(moveOwnFiles(from, to, io)).rejects.toMatchObject({ code: 'files-conflict' });
        expect(await names(to)).toEqual(['notes.md']);
        expect(await readFile(join(to, 'notes.md'), 'utf8')).toBe('someone else');
        expect(await names(from)).toEqual(['.env', 'notes.md', 'sketches']);
    });

    test("leaves a file manager's .DS_Store behind and still removes the emptied folder", async () => {
        await writeFile(join(from, '.DS_Store'), 'junk');
        await writeFile(join(to, '.DS_Store'), 'theirs');
        const result = await moveOwnFiles(from, to);
        expect(result.moved).toEqual(['.env', 'notes.md', 'sketches']);
        expect(await readFile(join(to, '.DS_Store'), 'utf8')).toBe('theirs');
        await expect(readdir(from)).rejects.toThrow();
    });

    test('moves nothing from a folder that is not there', async () => {
        const result = await moveOwnFiles(join(root, 'nowhere'), to);
        expect(result.moved).toEqual([]);
        await result.undo();
    });

    test('leaves a folder that is not empty after the move', async () => {
        await writeFile(join(from, 'late.md'), 'x');
        const io: OwnFilesIO = {
            rename: async (source, target) => {
                await renameNoReplace(source, target);
                await writeFile(join(from, 'late.md'), 'x');
            },
            copy: copyIO
        };
        await moveOwnFiles(from, to, io);
        expect(await names(from)).toEqual(['late.md']);
    });
});

describe('copyWithoutReplacing', () => {
    test('copies a folder to a free name and leaves no temporary sibling', async () => {
        await copyWithoutReplacing(join(from, 'sketches'), join(to, 'sketches'));
        expect(await readFile(join(to, 'sketches', 'a.txt'), 'utf8')).toBe('sketch');
        expect(await names(to)).toEqual(['sketches']);
    });

    test('refuses a taken name and leaves it as it was', async () => {
        await writeFile(join(to, 'notes.md'), 'theirs');
        await expect(copyWithoutReplacing(join(from, 'notes.md'), join(to, 'notes.md'))).rejects.toMatchObject({ code: expect.stringMatching(/EEXIST/) });
        expect(await readFile(join(to, 'notes.md'), 'utf8')).toBe('theirs');
        expect(await names(to)).toEqual(['notes.md']);
    });

    test('never writes into a name that appears while the copy runs', async () => {
        const slow = async (source: string, target: string): Promise<void> => {
            await copyIO(source, target);
            await writeFile(join(to, 'notes.md'), 'appeared meanwhile');
        };
        await expect(copyWithoutReplacing(join(from, 'notes.md'), join(to, 'notes.md'), slow)).rejects.toMatchObject({ code: 'EEXIST' });
        expect(await readFile(join(to, 'notes.md'), 'utf8')).toBe('appeared meanwhile');
        expect(await names(to)).toEqual(['notes.md']);
    });

    test('removes the temporary copy when the copy fails', async () => {
        const failing = async (source: string, target: string): Promise<void> => {
            await copyIO(source, target);
            throw error('EIO');
        };
        await expect(copyWithoutReplacing(join(from, 'notes.md'), join(to, 'notes.md'), failing)).rejects.toThrow('EIO');
        expect(await names(to)).toEqual([]);
    });
});
