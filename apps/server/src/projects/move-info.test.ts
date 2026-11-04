import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ChatItem } from '@ruimte/contracts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { chatMoveInfo, type MoveInfoDeps } from './move-info.ts';

let root: string;

const newHome = tempHomes('move-info-');

beforeEach(async () => {
    root = await newHome();
});

function user(id: string, chats?: string[]): ChatItem {
    return { id, kind: 'user', createdAt: 1, turnId: id, text: 'hi', ...(chats === undefined ? {} : { chats }) };
}

function read(id: string, path: string): ChatItem {
    return {
        id,
        kind: 'tool',
        createdAt: 1,
        turnId: 't',
        toolUseId: id,
        name: 'Read',
        input: { file_path: path },
        output: null,
        state: 'done',
        parentToolUseId: null
    };
}

function deps(threads: Record<string, ChatItem[]>, overrides: Partial<MoveInfoDeps> = {}): MoveInfoDeps {
    return {
        home: join(root, 'home'),
        ruimteHome: join(root, 'home', '.ruimte'),
        refusal: () => null,
        thread: async (chatId) => (threads[chatId] === undefined ? null : { cwd: join(root, 'scratch', chatId), items: threads[chatId]! }),
        ownFolder: (chatId) => join(root, 'scratch', chatId),
        chatsInChats: async () => Object.keys(threads),
        projects: async () => [],
        branchOf: async () => null,
        gitRoot: async () => null,
        refuseFolder: async () => undefined,
        ...overrides
    };
}

async function own(chatId: string, names: string[]): Promise<void> {
    await mkdir(join(root, 'scratch', chatId), { recursive: true });
    for (const name of names) {
        await writeFile(join(root, 'scratch', chatId, name), 'x');
    }
}

describe('chatMoveInfo', () => {
    test('lists the own files with the hidden ones and cuts the names at five', async () => {
        await own('chat-1', ['a.md', 'b.md', 'c.md', 'd.md', 'e.md', '.env']);
        const info = await chatMoveInfo({ chatId: 'chat-1' }, deps({ 'chat-1': [] }));
        expect(info.ownFiles).toEqual({ folder: join(root, 'scratch', 'chat-1'), count: 6, names: ['.env', 'a.md', 'b.md', 'c.md', 'd.md'] });
    });

    test('does not count a .DS_Store, nor call it a clash', async () => {
        await own('chat-1', ['notes.md', '.DS_Store']);
        const target = join(root, 'vinyl');
        await mkdir(target);
        await writeFile(join(target, '.DS_Store'), 'y');
        const to = { folder: target, name: 'Vinyl', createFolder: false, initGit: false };
        const info = await chatMoveInfo({ chatId: 'chat-1', to }, deps({ 'chat-1': [] }));
        expect(info.ownFiles).toMatchObject({ count: 1, names: ['notes.md'] });
        expect(info.conflicts).toEqual([]);
    });

    test('reports no own files for a chat that never made its folder', async () => {
        const info = await chatMoveInfo({ chatId: 'chat-1' }, deps({ 'chat-1': [] }));
        expect(info.ownFiles.count).toBe(0);
    });

    test('names the clashes with a target folder, and none without a target', async () => {
        await own('chat-1', ['notes.md', 'schema.sql']);
        const target = join(root, 'vinyl');
        await mkdir(target);
        await writeFile(join(target, 'notes.md'), 'y');
        const threads = { 'chat-1': [] };
        expect((await chatMoveInfo({ chatId: 'chat-1' }, deps(threads))).conflicts).toEqual([]);
        const toFolder = { chatId: 'chat-1', to: { folder: target, name: 'Vinyl', createFolder: false, initGit: false } };
        expect((await chatMoveInfo(toFolder, deps(threads))).conflicts).toEqual(['notes.md']);
        const registered = deps(threads, { projects: async () => [{ projectId: 'p1', name: 'Vinyl', folder: target, available: true }] });
        expect((await chatMoveInfo({ chatId: 'chat-1', to: { projectId: 'p1' } }, registered)).conflicts).toEqual(['notes.md']);
    });

    test('puts the project the registry has for a worked folder beside it', async () => {
        const checkout = join(root, 'home', 'Projects', 'vinyl');
        const threads = { 'chat-1': [read('r1', join(checkout, 'a.ts')), read('r2', join(checkout, 'b.ts'))] };
        const info = await chatMoveInfo(
            { chatId: 'chat-1' },
            deps(threads, {
                gitRoot: async () => checkout,
                projects: async () => [{ projectId: 'p1', name: 'Vinyl', folder: checkout, available: true }],
                branchOf: async () => 'main'
            })
        );
        expect(info.folders).toEqual([{ path: checkout, project: { projectId: 'p1', name: 'Vinyl' }, branch: 'main', files: 2 }]);
    });

    test('counts the chats that link to this one and the chats it links to, once each', async () => {
        const threads = {
            'chat-1': [user('u1', ['chat-2', 'chat-3', 'chat-gone'])],
            'chat-2': [user('u2', ['chat-1'])],
            'chat-3': [],
            'chat-4': [user('u4', ['chat-1'])],
            'chat-5': [user('u5', ['chat-3'])]
        };
        const info = await chatMoveInfo({ chatId: 'chat-1' }, deps(threads));
        expect(info.references).toBe(3);
    });

    test('counts a chat linked with # the same as one linked with @', async () => {
        const pointing = (id: string, references: string[]): ChatItem => ({ id, kind: 'user', createdAt: 1, turnId: id, text: 'hi', references });
        const threads = {
            'chat-1': [pointing('u1', ['chat-2', 'chat-gone'])],
            'chat-2': [],
            'chat-3': [pointing('u3', ['chat-1'])],
            'chat-4': [pointing('u4', ['chat-2'])]
        };
        expect((await chatMoveInfo({ chatId: 'chat-1' }, deps(threads))).references).toBe(2);
    });

    test('suggests the parent most projects share, else home', async () => {
        const home = join(root, 'home');
        expect((await chatMoveInfo({ chatId: 'chat-1' }, deps({ 'chat-1': [] }))).newFolderParent).toBe(home);
        const projects = async () => [
            { projectId: 'a', name: 'A', folder: '/work/a', available: true },
            { projectId: 'b', name: 'B', folder: '/work/b', available: true },
            { projectId: 'c', name: 'C', folder: '/elsewhere/c', available: true }
        ];
        expect((await chatMoveInfo({ chatId: 'chat-1' }, deps({ 'chat-1': [] }, { projects }))).newFolderParent).toBe('/work');
    });

    test('reads nothing for an id that is no chat of Chats, however it is spelled', async () => {
        await own('chat-1', ['secret.md']);
        const asked: string[] = [];
        const guarded = deps(
            {},
            {
                refusal: () => ({ reason: 'not-in-chats' }),
                ownFolder: (chatId) => (asked.push(chatId), join(root, 'scratch', chatId)),
                thread: async (chatId) => (asked.push(chatId), null),
                chatsInChats: async () => (asked.push('list'), [])
            }
        );
        for (const chatId of ['../../../../etc', '..', 'chat-1/../chat-1']) {
            const to = { folder: root, name: 'Root', createFolder: false, initGit: false };
            expect(await chatMoveInfo({ chatId, to }, guarded)).toMatchObject({
                folders: [],
                ownFiles: { folder: '', count: 0, names: [] },
                conflicts: [],
                references: 0,
                refusal: { reason: 'not-in-chats' }
            });
        }
        expect(asked).toEqual([]);
    });

    test("leaves projects that are gone or that live in the machine's data folder out of the suggested parent", async () => {
        const data = join(root, 'home', '.ruimte');
        const projects = async () => [
            { projectId: 'a', name: 'A', folder: '/work/a', available: true },
            { projectId: 'b', name: 'B', folder: '/gone/b', available: false },
            { projectId: 'c', name: 'C', folder: '/gone/c', available: false },
            { projectId: 'd', name: 'D', folder: join(data, 'worktrees', 'd'), available: true },
            { projectId: 'e', name: 'E', folder: join(data, 'worktrees', 'e'), available: true }
        ];
        expect((await chatMoveInfo({ chatId: 'chat-1' }, deps({ 'chat-1': [] }, { projects }))).newFolderParent).toBe('/work');
    });

    test('lists nothing of a target folder the machine keeps its own state in', async () => {
        const state = join(root, 'home', '.ruimte', 'chats');
        await mkdir(state, { recursive: true });
        await writeFile(join(state, 'chat-9.json'), 'x');
        await own('chat-1', ['chat-9.json']);
        const refusing = deps(
            { 'chat-1': [] },
            {
                refuseFolder: async (folder) => {
                    throw Object.assign(new Error(`${folder} belongs to this machine`), { code: 'machine-state' });
                }
            }
        );
        const to = { folder: state, name: 'State', createFolder: false, initGit: false };
        await expect(chatMoveInfo({ chatId: 'chat-1', to }, refusing)).rejects.toMatchObject({ code: 'machine-state' });
    });

    test('carries the refusal', async () => {
        const info = await chatMoveInfo({ chatId: 'chat-1' }, deps({ 'chat-1': [] }, { refusal: () => ({ reason: 'working' }) }));
        expect(info.refusal).toEqual({ reason: 'working' });
    });
});
