import { describe, expect, test } from 'bun:test';
import type { ChatWorkflow, ChatWorkflowAgent } from '@ruimte/agent-contracts';
import { workflowAgentState, workflowAgentTime, workflowPhases } from './workflow';

const agent = (index: number, patch: Partial<ChatWorkflowAgent> = {}): ChatWorkflowAgent => ({
    index,
    label: `agent-${index}`,
    phaseIndex: 1,
    agentId: `a${index}`,
    status: 'running',
    startedAt: 1000,
    durationMs: null,
    lastTool: null,
    ...patch
});

const workflow = (agents: ChatWorkflowAgent[]): ChatWorkflow => ({
    name: 'write-and-read',
    phases: [
        { index: 1, title: 'Write' },
        { index: 2, title: 'Read' }
    ],
    agents
});

describe('workflowPhases', () => {
    test('every announced phase is there in order with its agents, one of no known phase first and untitled', () => {
        const phases = workflowPhases(workflow([agent(1), agent(2, { phaseIndex: null }), agent(3, { phaseIndex: 9 })]), true);
        expect(phases.map((phase) => [phase.title, phase.agents.map((view) => view.agent.index)])).toEqual([
            [null, [2, 3]],
            ['Write', [1]],
            ['Read', []]
        ]);
    });

    test('an agent the last report had at work stopped with its workflow, and one without a start still waits', () => {
        expect(workflowAgentState(agent(1), true)).toBe('running');
        expect(workflowAgentState(agent(1, { startedAt: null }), true)).toBe('waiting');
        expect(workflowAgentState(agent(1), false)).toBe('stopped');
        expect(workflowAgentState(agent(1, { status: 'done' }), false)).toBe('done');
        expect(workflowPhases(workflow([agent(1)]), false)[0]!.agents[0]!.state).toBe('stopped');
    });
});

describe('workflowAgentTime', () => {
    test('a settled agent says how long it took, and the others what they are doing', () => {
        expect(workflowAgentTime({ agent: agent(1, { status: 'done', durationMs: 5421 }), state: 'done' })).toBe('done in 5s');
        expect(workflowAgentTime({ agent: agent(1, { status: 'failed', durationMs: 2000 }), state: 'failed' })).toBe('failed in 2s');
        expect(workflowAgentTime({ agent: agent(1, { status: 'failed' }), state: 'failed' })).toBe('failed');
        expect(workflowAgentTime({ agent: agent(1, { startedAt: null }), state: 'waiting' })).toBe('waiting');
        expect(workflowAgentTime({ agent: agent(1), state: 'stopped' })).toBe('stopped');
        expect(workflowAgentTime({ agent: agent(1), state: 'running' })).toBeNull();
    });
});
