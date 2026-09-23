import { describe, expect, test } from 'bun:test';
import type { AgentStatus, ChatTurnItem } from '@ruimte/contracts';
import { agentStates, type AgentStateSources } from './agent-state.ts';

const sources = (
    statuses: Record<string, AgentStatus>,
    cancelled: string[],
    turns: Record<string, ChatTurnItem['state']> = {},
    stored: readonly string[] = []
): AgentStateSources =>
    ({
        outbox: { list: () => [] },
        lineage: { endedAt: () => null, startedBy: () => null },
        chats: {
            get: (id: string) => (statuses[id] === undefined ? undefined : { info: { status: statuses[id] } }),
            hasStored: async (id: string) => stored.includes(id),
            cancel: (id: string) => {
                cancelled.push(id);
            },
            lastTurn: async (id: string) => (turns[id] === undefined ? null : { kind: 'turn', state: turns[id] })
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

    test('a chat at rest whose last turn was stopped reads stopped, loaded or only on disk', async () => {
        const host = agentStates(
            sources({ halted: 'idle', finished: 'idle', busy: 'running' }, [], { halted: 'aborted', finished: 'done', busy: 'aborted', resting: 'aborted' }, [
                'resting'
            ])
        );
        expect(await host.stateOf('halted')).toBe('stopped');
        expect(await host.stateOf('resting')).toBe('stopped');
        expect(await host.stateOf('finished')).toBe('idle');
        expect(await host.stateOf('busy')).toBe('running');
    });
});
