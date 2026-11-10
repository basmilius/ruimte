import { beforeEach, describe, expect, test } from 'bun:test';
import { join, resolve } from 'node:path';
import type { ChatItem, LaunchStatus } from '@ruimte/contracts';
import type { OutboxEntry, OutboxWork, RunAfterSettleEntry } from '../outbox/outbox.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { AfterSettleLaunches, AfterSettleStore, type AfterSettleDeps } from './after-settle.ts';
import type { ResolvedLaunch } from './store.ts';

const WORKTREE = resolve('/worktrees/repo-fix');

interface FakeChat {
    info: Record<string, unknown>;
    items: ChatItem[];
}

let home: string;
let now: number;
let store: AfterSettleStore;
let chats: Map<string, FakeChat>;
let entries: OutboxEntry[];
let notes: Array<{ chatId: string; noteId: string; note: string; preamble: string }>;
let started: Array<{ cwd: string; worktree: string }>;
let approved: boolean;
let running: boolean;
let worktrees: string[];
let peerChats: Set<string>;
let finish: (status: Partial<LaunchStatus>) => void;
let settle: AfterSettleLaunches;

function turn(id: string, state: 'running' | 'done' | 'aborted' | 'error', endedAt: number | null = 2_000): ChatItem {
    return { id, kind: 'turn', createdAt: 1_000, turnId: id, state, endedAt } as unknown as ChatItem;
}

function chat(overrides: Record<string, unknown> = {}, items: ChatItem[] = [turn('turn-1', 'done')]): FakeChat {
    return { info: { cwd: join(WORKTREE, 'src'), activeTurnId: null, status: 'idle', ...overrides }, items };
}

function deps(): AfterSettleDeps {
    return {
        store,
        chats: {
            get: (chatId: string) => {
                const found = chats.get(chatId);
                return found === undefined ? undefined : { info: found.info, thread: { list: () => found.items } };
            },
            isLoading: () => false,
            deliverNote: async (chatId: string, delivery: { noteId: string; note: string; preamble: string }) => {
                if (notes.some((note) => note.chatId === chatId && note.noteId === delivery.noteId)) {
                    return false;
                }
                notes.push({ chatId, ...delivery });
                return true;
            }
        } as unknown as AfterSettleDeps['chats'],
        launches: {
            inWorktree: async (projectId: string, launchId: string, folder: string) =>
                ({ projectId, folder: '/repo', launch: { id: launchId, name: 'Run tests', kind: 'task' }, cwd: folder, approved }) as unknown as ResolvedLaunch
        },
        runner: {
            startIn: async (resolved, worktree) => {
                if (running) {
                    return { outcome: 'running' };
                }
                started.push({ cwd: resolved.cwd, worktree });
                return {
                    outcome: 'started',
                    ended: new Promise<LaunchStatus>((resolve) => {
                        finish = (status) => resolve({ stopped: false, exitCode: 0, ...status } as LaunchStatus);
                    })
                };
            }
        },
        projectOf: (chatId) => (chats.has(chatId) ? 'p1' : null),
        isPeerChat: (chatId) => peerChats.has(chatId),
        folderOf: (projectId) => (projectId === 'p1' ? '/repo' : null),
        worktreesOf: async () => worktrees,
        repoRootOf: async () => '/repo',
        ofKind: () => entries as RunAfterSettleEntry[],
        enqueue: async (projectId: string, target: string, work: OutboxWork) => {
            entries.push({ ...work, id: `entry-${entries.length}`, projectId, target, createdAt: now, attempts: 0, notBefore: now } as OutboxEntry);
        }
    };
}

function tell(chatId: string): void {
    settle.chatEvent({ event: 'chat.event', payload: { chatId, event: { type: 'info' } } } as never);
}

async function flush(): Promise<void> {
    for (let i = 0; i < 10; i++) {
        await Promise.resolve();
    }
}

async function choose(launchId: string | null, at = 1_500): Promise<void> {
    now = at;
    await store.choose('p1', launchId);
}

const newHome = tempHomes('ruimte-after-settle-');

beforeEach(async () => {
    home = await newHome();
    now = 0;
    store = new AfterSettleStore({ path: join(home, 'launch-after-settle.json'), now: () => now });
    chats = new Map();
    entries = [];
    notes = [];
    started = [];
    approved = true;
    running = false;
    worktrees = [WORKTREE];
    peerChats = new Set();
    finish = () => undefined;
    settle = new AfterSettleLaunches(deps());
});

describe('owing a run when a worktree chat settles', () => {
    test('a turn that ended done in a worktree owes one run, however often the chat says so', async () => {
        await choose('run-tests');
        chats.set('chat-1', chat());
        tell('chat-1');
        tell('chat-1');
        await flush();
        expect(entries).toMatchObject([
            { kind: 'run-after-settle', target: 'chat-1', payload: { turnId: 'turn-1', launchId: 'run-tests', worktree: WORKTREE } }
        ]);
        tell('chat-1');
        await flush();
        expect(entries).toHaveLength(1);
    });

    test('nothing is owed while anything still holds the chat', async () => {
        await choose('run-tests');
        const holds: FakeChat[] = [
            chat({ activeTurnId: 'turn-2' }),
            chat({ status: 'needs-you' }),
            chat({ goal: { objective: 'Ship', status: 'active' } }),
            chat({ background: [{ id: 'bg-1', description: 'dev server' }] }),
            chat({ queue: [{ id: 'q-1' }] }),
            chat({ delegating: true }),
            chat({}, [turn('turn-1', 'aborted')]),
            chat({}, [turn('turn-1', 'error')]),
            chat({}, [turn('turn-1', 'done'), { id: 'sub-1', kind: 'subagent', background: true, status: 'running', origin: 'cli' } as unknown as ChatItem])
        ];
        holds.forEach((held, i) => chats.set(`chat-${i}`, held));
        for (const chatId of chats.keys()) {
            tell(chatId);
        }
        await flush();
        expect(entries).toEqual([]);
    });

    test('a chat outside a worktree, a project without a choice and a turn before the choice owe nothing', async () => {
        chats.set('chat-1', chat({ cwd: '/repo/src' }));
        chats.set('chat-2', chat());
        tell('chat-2');
        await flush();
        expect(entries).toEqual([]);
        await choose('run-tests', 2_500);
        tell('chat-1');
        tell('chat-2');
        await flush();
        expect(entries).toEqual([]);
    });
});

describe('a chat another machine gave its task', () => {
    test('owes nothing when it settles in a worktree', async () => {
        await choose('run-tests');
        chats.set('chat-1', chat());
        peerChats.add('chat-1');
        tell('chat-1');
        await flush();
        expect(entries).toEqual([]);
    });

    test('starts nothing from an entry that was owed before it was known as such', async () => {
        await choose('run-tests');
        chats.set('chat-1', chat());
        tell('chat-1');
        await flush();
        peerChats.add('chat-1');
        await settle.handle(entries[0] as RunAfterSettleEntry);
        expect(started).toEqual([]);
        expect(notes).toEqual([]);
    });
});

describe('running it', () => {
    async function owed(): Promise<RunAfterSettleEntry> {
        await choose('run-tests');
        chats.set('chat-1', chat());
        tell('chat-1');
        await flush();
        return entries[0] as RunAfterSettleEntry;
    }

    test('starts in the project folder of the worktree and notes the start and the exit code without a wake', async () => {
        const entry = await owed();
        await settle.handle(entry);
        expect(started).toEqual([{ cwd: WORKTREE, worktree: WORKTREE }]);
        expect(notes.map((note) => note.note)).toEqual(['Run tests started in this worktree after this turn.']);
        finish({ state: 'exited', exitCode: 1 });
        await flush();
        expect(notes.at(-1)).toMatchObject({
            noteId: 'after-settle-turn-1-ended',
            note: 'Run tests ended with exit code 1.',
            preamble: expect.stringContaining('launch_read run-tests')
        });
    });

    test('runs once per settled turn, across a restart too', async () => {
        const entry = await owed();
        await settle.handle(entry);
        await settle.handle(entry);
        expect(started).toHaveLength(1);
        store = new AfterSettleStore({ path: join(home, 'launch-after-settle.json'), now: () => now });
        settle = new AfterSettleLaunches(deps());
        await settle.handle(entry);
        entries = [];
        tell('chat-1');
        await flush();
        expect(started).toHaveLength(1);
        expect(entries).toEqual([]);
    });

    test('a later turn that settles runs it again', async () => {
        await settle.handle(await owed());
        chats.set('chat-1', chat({}, [turn('turn-1', 'done'), turn('turn-2', 'done', 3_000)]));
        tell('chat-1');
        await flush();
        await settle.handle(entries.at(-1) as RunAfterSettleEntry);
        expect(started).toHaveLength(2);
    });

    test('without the approval for worktrees nothing starts, and the chat hears it waits on a person', async () => {
        approved = false;
        await settle.handle(await owed());
        expect(started).toEqual([]);
        expect(notes.map((note) => note.noteId)).toEqual(['after-settle-turn-1-held']);
    });

    test('a task that will not start leaves the chat a note saying why', async () => {
        const entry = await owed();
        settle = new AfterSettleLaunches({
            ...deps(),
            runner: { startIn: () => Promise.reject(new Error('backend is not a folder')) }
        });
        await settle.handle(entry);
        expect(notes).toMatchObject([{ noteId: 'after-settle-turn-1-failed', note: expect.stringContaining('backend is not a folder') }]);
    });

    test('a launch that already runs is left alone', async () => {
        running = true;
        await settle.handle(await owed());
        expect(notes.map((note) => note.noteId)).toEqual(['after-settle-turn-1-busy']);
    });

    test('a pending run lapses when the worktree went or a person chose another task or none', async () => {
        const entry = await owed();
        worktrees = [];
        await settle.handle(entry);
        await choose('run-build');
        worktrees = [WORKTREE];
        await settle.handle(entry);
        await choose(null);
        await settle.handle(entry);
        expect(started).toEqual([]);
        expect(notes).toEqual([]);
        expect(store.handledTurn('chat-1')).toBeNull();
    });

    test('a chat that left its project takes what it ran along', async () => {
        await settle.handle(await owed());
        store.places('p1', new Set());
        expect(store.handledTurn('chat-1')).toBeNull();
    });
});
