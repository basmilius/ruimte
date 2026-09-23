import { describe, expect, test } from 'bun:test';
import type { AgentStatus } from '@ruimte/contracts';
import { agentStates, type AgentStateSources } from './agent-state.ts';

const sources = (statuses: Record<string, AgentStatus>, cancelled: string[]): AgentStateSources =>
    ({
        outbox: { list: () => [] },
        lineage: { endedAt: () => null },
        chats: {
            get: (id: string) => (statuses[id] === undefined ? undefined : { info: { status: statuses[id] } }),
            hasStored: async () => false,
            cancel: (id: string) => {
                cancelled.push(id);
            }
        },
        sessions: { get: () => undefined }
    }) as unknown as AgentStateSources;

describe('agentStates', () => {
    test('cancels the turn of a chat that works or waits on a person, and nothing else', () => {
        const cancelled: string[] = [];
        const host = agentStates(sources({ busy: 'running', asking: 'needs-you', resting: 'idle' }, cancelled));
        expect(host.cancelTurn('busy')).toBe(true);
        expect(host.cancelTurn('asking')).toBe(true);
        expect(host.cancelTurn('resting')).toBe(false);
        expect(host.cancelTurn('terminal')).toBe(false);
        expect(cancelled).toEqual(['busy', 'asking']);
    });
});
