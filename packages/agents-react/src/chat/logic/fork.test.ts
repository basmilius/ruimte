import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/agent-contracts';
import {
    branchRefusal,
    forkedTurnIds,
    forkIdsAfter,
    summaryRefusal,
    forkPayload,
    forkPointLabel,
    forkPointOf,
    forkRefusal,
    forkShapes,
    lastSettledTurn,
    turnIdOfRow
} from './fork';
import { deriveTimelineRows } from './timeline';

const info = (patch: Partial<ChatInfo> = {}): ChatInfo => ({
    chatId: 'chat-1',
    provider: 'claude',
    cwd: '/work',
    agentSessionId: 'session-1',
    model: null,
    selection: { model: 'm', options: {} },
    runtimeMode: 'full-access',
    status: 'idle',
    running: false,
    activeTurnId: null,
    slashCommands: [],
    usage: { contextTokens: 0, contextWindow: null, costUsd: 0, turns: 3 },
    createdAt: 0,
    ...patch
});

const thread: ChatItem[] = [
    { id: 't1', kind: 'turn', createdAt: 0, turnId: 't1', state: 'done', endedAt: 1, costUsd: 0 },
    { id: 'u1', kind: 'user', createdAt: 0, turnId: 't1', text: '\nMake the lexer handle unicode identifiers everywhere it reads a name\nand test it' },
    { id: 't2', kind: 'turn', createdAt: 2, turnId: 't2', state: 'aborted', endedAt: 3, costUsd: 0, origin: 'agent', label: 'Woken by 2 tasks' },
    { id: 't3', kind: 'turn', createdAt: 4, turnId: 't3', state: 'running', endedAt: null, costUsd: 0 }
];
const items = Object.fromEntries(thread.map((item) => [item.id, item]));
const order = thread.map((item) => item.id);

describe('fork', () => {
    test('a settled turn of a chat with a conversation forks; a running one, another CLI or no session says why not', () => {
        expect(forkRefusal(info(), items.t1)).toBeNull();
        expect(forkRefusal(info(), items.t3)).toBe('Wait for the turn to end');
        expect(forkRefusal(info({ activeTurnId: 't3' }), items.t1)).toBe('Wait for the turn to end');
        expect(forkRefusal(info({ provider: 'gemini' }), items.t1)).not.toBeNull();
        expect(forkRefusal(info({ agentSessionId: null }), items.t1)).not.toBeNull();
        expect(forkRefusal(info(), items.u1)).not.toBeNull();
    });

    test('a row of the thread names the turn it belongs to, and a row outside every turn names none', () => {
        const rows = deriveTimelineRows(thread, { expandedGroups: new Set(), expandedTurns: new Set(), expandedSubagents: new Set(), activeTurnId: 't3' });
        expect(rows.find((row) => row.id === 'u1')).toBeDefined();
        expect(turnIdOfRow(rows.find((row) => row.id === 'u1')!)).toBe('t1');
        expect(turnIdOfRow({ kind: 'note', id: 'n1', level: 'info', text: 'x' })).toBeNull();
    });

    test('the menu of a node forks after the last turn that ended', () => {
        expect(lastSettledTurn(items, order)).toBe('t2');
    });

    test('the point names the turn by its place and the first line of what was asked, or the label of a wake', () => {
        const first = forkPointOf(items, order, 't1')!;
        expect(first).toEqual({
            turnId: 't1',
            number: 1,
            total: 3,
            last: false,
            prompt: 'Make the lexer handle unicode identifiers everywhere it reads a name'
        });
        expect(forkPointLabel(first)).toBe('After turn 1 of 3: "Make the lexer handle unicode identifiers everywhere it rea…"');
        expect(forkPointLabel(forkPointOf(items, order, 't3')!)).toBe('After the last turn');
        expect(forkPointOf(items, order, 't2')!.prompt).toBe('Woken by 2 tasks');
        expect(forkPointOf(items, order, 'missing')).toBeNull();
    });
});

describe('the shape of a fork', () => {
    test('a view forks only into a view, and a node into a node unless a view is picked', () => {
        expect(forkShapes('view')).toEqual(['view']);
        expect(forkShapes('node')).toEqual(['node', 'view']);
    });

    test('only a view asks the machine for one', () => {
        const base = { chatId: 'chat-1', turnId: 't1', title: 'Lexer (fork)' };
        expect(forkPayload({ ...base, shape: 'node' })).toEqual(base);
        expect(forkPayload({ ...base, shape: 'view' })).toEqual({ ...base, asView: true });
        expect(forkPayload({ ...base, shape: 'node', worktree: { branch: 'lexer-fork', filesAfterTurn: true } })).toEqual({
            ...base,
            worktree: { branch: 'lexer-fork' },
            filesAfterTurn: true
        });
        expect(forkPayload({ ...base, shape: 'node', worktree: { branch: 'lexer-fork', filesAfterTurn: false } })).toEqual({
            ...base,
            worktree: { branch: 'lexer-fork' }
        });
        expect(forkPayload({ ...base, shape: 'node', worktree: null })).toEqual(base);
        const original = { provider: 'claude' as const, selection: { model: 'opus', options: { effort: 'high' } } };
        expect(forkPayload({ ...base, shape: 'node', cli: { original, chosen: original } })).toEqual(base);
        expect(forkPayload({ ...base, shape: 'node', cli: { original, chosen: { provider: 'claude', selection: { model: 'sonnet', options: {} } } } })).toEqual(
            {
                ...base,
                selection: { model: 'sonnet', options: {} }
            }
        );
        expect(forkPayload({ ...base, shape: 'node', cli: { original, chosen: { provider: 'codex', selection: { model: 'gpt-5.5', options: {} } } } })).toEqual(
            {
                ...base,
                provider: 'codex',
                selection: { model: 'gpt-5.5', options: {} }
            }
        );
    });

    test('names an account only when it is not the one the fork would go on under anyway', () => {
        const base = { chatId: 'chat-1', turnId: 't1', title: 'Lexer (fork)', shape: 'node' as const };
        const original = { provider: 'claude' as const, selection: { model: 'opus', options: {} }, account: 'claude' };
        expect(forkPayload({ ...base, cli: { original, chosen: original } }).account).toBeUndefined();
        expect(forkPayload({ ...base, cli: { original, chosen: { ...original, account: 'claude_work' } } }).account).toBe('claude_work');
        const codex = { provider: 'codex' as const, selection: { model: 'gpt-5.5', options: {} }, account: 'codex' };
        expect(forkPayload({ ...base, cli: { original, chosen: codex } }).account).toBe('codex');
    });

    test('a summary waits for the fork to end its turn and needs its original', () => {
        expect(summaryRefusal({ busy: false, originalPresent: true })).toBeNull();
        expect(summaryRefusal({ busy: true, originalPresent: true })).toBe('Wait for the turn to end');
        expect(summaryRefusal({ busy: true, originalPresent: false })).toBe('The original is no longer in this project');
    });

    test('the forks after a turn are found among the chats this client knows', () => {
        const at = { chatId: 'chat-1', turnId: 't1', at: 0 };
        const infos = [
            info({ chatId: 'fork-1', forkOf: at }),
            info({ chatId: 'fork-2', forkOf: at }),
            info({ chatId: 'fork-3', forkOf: { ...at, turnId: 't2' } }),
            info()
        ];
        expect(forkIdsAfter(infos, 'chat-1', 't1')).toEqual(['fork-1', 'fork-2']);
        expect(forkIdsAfter(infos, 'chat-1', 't3')).toEqual([]);
        expect(forkedTurnIds(infos, 'chat-1')).toEqual(new Set(['t1', 't2']));
        expect(forkedTurnIds(infos, 'fork-1')).toEqual(new Set());
    });

    test('a branch has to be named and free', () => {
        expect(branchRefusal(' ', ['main'])).toBe('Name the branch');
        expect(branchRefusal('main ', ['main'])).toBe('A branch with this name exists already');
        expect(branchRefusal('lexer-fork', ['main'])).toBeNull();
    });
});
