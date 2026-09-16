import { describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import { forkPointLabel, forkPointOf, forkRefusal, lastSettledTurn, turnIdOfRow } from './fork';
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
        expect(forkPointLabel(first)).toBe('After turn 1 of 3: "Make the lexer handle unicode identifiers everywhere it r..."');
        expect(forkPointLabel(forkPointOf(items, order, 't3')!)).toBe('After the last turn');
        expect(forkPointOf(items, order, 't2')!.prompt).toBe('Woken by 2 tasks');
        expect(forkPointOf(items, order, 'missing')).toBeNull();
    });
});
