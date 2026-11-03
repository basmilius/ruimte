import { expect, test } from 'bun:test';
import { MAX_OPENED_PER_CALLER } from '@ruimte/actions';
import { toolAnswer, toolCall } from '../tools/tool-test-helpers.ts';
import type { CanvasHost } from '../tools/host.ts';
import type { AgentForkInput, ForkOpener } from '../chat/fork.ts';

test('agent_fork sends its branch to the owned fork host under the caller ceiling without asking for a person token', async () => {
    const received: { input: AgentForkInput; opener: ForkOpener }[] = [];
    let opened = 1;
    const host = {
        projects: {
            locate: () => ({ projectId: 'atlas', folder: '/work/atlas', canvasId: 'main' }),
            machineOfNode: () => null
        },
        agents: { startedBy: () => 'lead' },
        lineage: { depthOf: () => 0 },
        starts: { openedCount: () => opened, modeOf: () => 'supervised' },
        forks: {
            fork: async (input: AgentForkInput, opener: ForkOpener) => {
                received.push({ input, opener });
                return {
                    nodeId: 'forked',
                    viewId: 'main',
                    title: 'Alternative',
                    worktree: { path: '/work/alternative', branch: 'alternative' }
                };
            }
        }
    } as unknown as CanvasHost;

    expect((await toolAnswer('agent_fork', { id: 'child', branch: 'alternative', title: 'Alternative' }, toolCall('lead', host))).lines).toEqual([
        'fork\tforked\tmain\talternative',
        'next\tGive it work with task_new with id forked and a prompt; its result wakes you once it settled'
    ]);
    expect(received).toHaveLength(1);
    expect(received[0]!.input).toEqual({ chatId: 'child', turnId: null, title: 'Alternative', branch: 'alternative' });
    expect(received[0]!.opener).toMatchObject({ id: 'lead', depth: 1, ceiling: 'supervised' });
    expect(() => received[0]!.opener.recount()).not.toThrow();
    opened = MAX_OPENED_PER_CALLER;
    expect(() => received[0]!.opener.recount()).toThrow(`You have ${MAX_OPENED_PER_CALLER} agents open`);
});
