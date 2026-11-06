import { expect, test } from 'bun:test';
import type { WakeParentEntry } from '../outbox/outbox.ts';
import { parkedNote } from './parked-note.ts';

const entry: WakeParentEntry = {
    kind: 'wake-parent',
    payload: { taskId: 'a' },
    id: 'wake-parent-1',
    projectId: 'project',
    target: 'chat-lead',
    createdAt: 1,
    attempts: 0,
    notBefore: 1
};

test('a wake given up on leaves a note in that chat and raises attention; a start given up on tells the chat that opened the node', () => {
    const notes: string[] = [];
    const alerts: string[] = [];
    const park = parkedNote({
        madeBy: (nodeId) => (nodeId === 'terminal-1' ? 'chat-lead' : null),
        titleFor: () => 'Lexer',
        note: async (chatId, text) => {
            notes.push(`${chatId}: ${text}`);
        },
        alert: (chatId) => alerts.push(chatId)
    });
    park(entry, new Error('disk full'));
    park({ ...entry, kind: 'start-agent', target: 'terminal-1', payload: { node: 'terminal', provider: 'claude', cwd: null } }, new Error('no shell'));
    park({ ...entry, kind: 'start-agent', target: 'terminal-2', payload: { node: 'terminal', provider: 'claude', cwd: null } }, new Error('no shell'));
    expect(notes).toEqual([
        'chat-lead: The machine could not wake this chat with the results of its tasks: disk full',
        'chat-lead: The machine could not start the agent in Lexer (terminal-1): no shell'
    ]);
    expect(alerts).toEqual(['chat-lead']);
});

test('each kind says what it could not do in its own words, and a kind with none says nothing', () => {
    const notes: string[] = [];
    const park = parkedNote({
        madeBy: () => 'chat-lead',
        titleFor: () => 'Watcher',
        note: async (_chatId, text) => {
            notes.push(text);
        },
        alert: () => undefined
    });
    park({ ...entry, kind: 'deliver-pr-watch', target: 'chat-watcher', payload: { watchId: 'w', key: 'k', text: 't', label: 'l' } }, new Error('no chat'));
    park({ ...entry, kind: 'resume-run', target: 'chat-1', payload: { turnId: 'turn-1', attempt: 1 } }, new Error('gone'));
    park({ ...entry, kind: 'connect-peer', target: 'peer:m', payload: { machineId: 'm', since: 1, interval: 1 } }, new Error('away'));
    park({ ...entry, kind: 'deliver-waiting', target: 'chat-1', payload: { childId: 'c', requestId: 'r' } }, new Error('away'));
    expect(notes).toEqual([
        'The machine could not hand this chat the news of its pull request watch: no chat',
        'The machine could not resume the turn of Watcher (chat-1) after a restart: gone'
    ]);
});
