import { beforeEach, expect, test } from 'bun:test';
import { agentsEndedWith, askBeforeEndingAgents, askBeforeStoppingTask, endsAgentsWarning, stopsTaskWarning, useEndingAgents } from '@/agents/end-children';

const machine = (children: Record<string, string[]>, failing = false) => ({
    request: async (_type: string, payload: { nodeId: string }) => {
        if (failing) {
            throw new Error('unknown request');
        }
        return { nodeIds: children[payload.nodeId] ?? [] };
    }
});

beforeEach(() => {
    useEndingAgents.setState({ pending: null });
});

test('counts every agent once, and leaves out the nodes that are going anyway', async () => {
    const transport = machine({ lead: ['child-a', 'child-b', 'helper'], helper: ['child-b'] }) as never;
    expect(await agentsEndedWith(transport, ['lead', 'helper'])).toBe(2);
    expect(await agentsEndedWith(transport, ['nobody'])).toBe(0);
    // A machine from before the question counts none, and so does no machine at all.
    expect(await agentsEndedWith(machine({}, true) as never, ['lead'])).toBe(0);
    expect(await agentsEndedWith(null, ['lead'])).toBe(0);
});

test('a delete that ends nothing runs at once, and one that does waits for the answer', async () => {
    const runs: string[] = [];
    await askBeforeEndingAgents(machine({}) as never, ['plain'], 'Shell', () => runs.push('plain'));
    expect(runs).toEqual(['plain']);
    expect(useEndingAgents.getState().pending).toBeNull();

    await askBeforeEndingAgents(machine({ lead: ['a', 'b', 'c'] }) as never, ['lead'], 'Lead', () => runs.push('lead'));
    expect(runs).toEqual(['plain']);
    expect(useEndingAgents.getState().pending).toMatchObject({ what: 'Lead', agents: 3 });
});

test('the warning counts', () => {
    expect(endsAgentsWarning(1)).toBe('Also ends the agent it opened. Its node stays on the canvas with what it did so far.');
    expect(endsAgentsWarning(3)).toBe('Also ends the 3 agents it opened. Their nodes stay on the canvas with what they did so far.');
});

test('stopping a task always asks, and counts the agents its node opened', async () => {
    const runs: string[] = [];
    await askBeforeStoppingTask(machine({}) as never, 'child', 'Review', () => runs.push('child'));
    expect(runs).toEqual([]);
    expect(useEndingAgents.getState().pending).toMatchObject({ what: 'Review', agents: 0, action: 'stop' });
    await askBeforeStoppingTask(machine({ child: ['grandchild'] }) as never, 'child', 'Review', () => runs.push('child'));
    expect(useEndingAgents.getState().pending).toMatchObject({ agents: 1, action: 'stop' });
    useEndingAgents.getState().pending?.run();
    expect(runs).toEqual(['child']);
    expect(stopsTaskWarning(0)).toBe(
        'Ends the agent working on this task and cancels the task without waking the chat that gave it. Its node stays on the canvas.'
    );
    expect(stopsTaskWarning(2)).toBe(
        'Ends the agent working on this task and cancels the task without waking the chat that gave it. Its node stays on the canvas. Also ends the 2 agents it opened. Their nodes stay on the canvas with what they did so far.'
    );
});
