import { beforeEach, describe, expect, test } from 'bun:test';
import { ANSWER_WAKES_NOTE, type CanvasHost } from '../canvas/host.ts';
import type { ProposalAnswer, ProposalAsk } from '../projects/project-proposals.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';

let asks: ProposalAsk[];
let answer: ProposalAnswer;
let host: CanvasHost;

beforeEach(() => {
    asks = [];
    answer = { proposalId: 'prop-1', outcome: 'waiting' };
    host = {
        projects: {
            locate: (id: string) => ({ projectId: 'chats', folder: '/home/.ruimte/scratch', canvasId: null, id }),
            read: async () => ({ views: [] })
        },
        proposals: {
            inChats: (chatId: string) => chatId === 'chat-1',
            propose: async (ask: ProposalAsk) => {
                asks.push(ask);

                return answer;
            }
        }
    } as unknown as CanvasHost;
});

async function call(name: string, input: Record<string, unknown>, caller = 'chat-1'): Promise<string[]> {
    return (await toolAnswer(name, input, toolCall(caller, host))).lines;
}

const PROPOSE = { name: 'Vinyl shelf', reason: 'The notes became a codebase' };

describe('project_propose', () => {
    test('suggests a project and says the answer wakes the chat', async () => {
        expect(await call('project_propose', { ...PROPOSE, folder: '/work/vinyl-shelf' })).toEqual(['proposal\tprop-1\twaiting', ANSWER_WAKES_NOTE]);
        expect(asks).toEqual([{ chatId: 'chat-1', name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' }]);
    });

    test('leaves the folder to the person when the agent names none', async () => {
        await call('project_propose', PROPOSE);

        expect(asks.at(-1)).not.toHaveProperty('folder');
    });

    test('refuses a caller outside Chats, a relative folder and a missing field, and asks nothing', async () => {
        expect((await call('project_propose', PROPOSE, 'chat-in-project'))[0]).toStartWith('refused\tnot-in-chats\t');
        expect((await call('project_propose', { ...PROPOSE, folder: 'vinyl-shelf' }))[0]).toStartWith('refused\tfolder-not-absolute\t');
        expect((await call('project_propose', { name: 'Vinyl shelf' }))[0]).toStartWith('refused\t');
        expect((await call('project_propose', { reason: 'x' }))[0]).toStartWith('refused\t');
        expect((await call('project_propose', { ...PROPOSE, wait: 30 }))[0]).toStartWith('refused\tbad-arguments\tproject_propose takes no wait');
        expect(asks).toEqual([]);
    });
});
