import { expect, test } from 'bun:test';
import { MAX_OPENED_PER_CALLER } from '@ruimte/actions';
import { forkVerb } from '../canvas/fork-verb.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { AgentForkInput, ForkOpener } from '../chat/fork.ts';

test('the agent fork verb sends its branch to the owned fork host under the caller ceiling without asking for a person token', async () => {
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

    expect(await forkVerb.run(['child', '--branch', 'alternative', '--title', 'Alternative'], { caller: 'lead', host })).toEqual([
        'fork\tforked\tmain\talternative',
        'next\tGive it work with task_new forked --prompt T; its result wakes you once it settled'
    ]);
    expect(received).toHaveLength(1);
    expect(received[0]!.input).toEqual({ chatId: 'child', turnId: null, title: 'Alternative', branch: 'alternative' });
    expect(received[0]!.opener).toMatchObject({ id: 'lead', depth: 1, ceiling: 'supervised' });
    expect(() => received[0]!.opener.recount()).not.toThrow();
    opened = MAX_OPENED_PER_CALLER;
    expect(() => received[0]!.opener.recount()).toThrow(`You have ${MAX_OPENED_PER_CALLER} agents open`);
});
