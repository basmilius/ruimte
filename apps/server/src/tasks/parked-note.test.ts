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
