import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRepo } from '../git/test-repo.ts';
import type { ProposalAnswer, ProposalAsk } from '../projects/project-proposals.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';
import type { CanvasHost } from './host.ts';

let asks: ProposalAsk[];
let answer: ProposalAnswer;
let host: CanvasHost;

beforeEach(() => {
    asks = [];
    answer = { proposalId: 'prop-1', outcome: 'declined' };
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
    test('suggests a project and prints only what became of the card', async () => {
        expect(await call('project_propose', { ...PROPOSE, folder: '/work/vinyl-shelf' })).toEqual(['proposal\tprop-1\tdeclined']);
        expect(asks).toEqual([{ chatId: 'chat-1', name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' }]);
    });

    test('prints every outcome', async () => {
        for (const outcome of ['declined', 'waiting'] as const) {
            answer = { proposalId: 'prop-1', outcome };
            expect((await call('project_propose', PROPOSE))[0]).toBe(`proposal\tprop-1\t${outcome}`);
        }

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

describe('project_ignored', () => {
    test('lists the files git ignores in the project, links apart, and refuses a folder outside a repository', async () => {
        const folder = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ignored-tool-')));
        const outside = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ignored-none-')));

        try {
            await initRepo(folder, { '.gitignore': '.env\nlatest\n' });
            await writeFile(join(folder, '.env'), 'KEY=1\n');
            await symlink(join(folder, '.env'), join(folder, 'latest'));

            host = { projects: { locate: (id: string) => ({ projectId: 'p', folder, canvasId: 'c', id }) } } as unknown as CanvasHost;
            expect(await call('project_ignored', {})).toEqual([`root\t${folder}`, 'file\t.env\t6', 'link\tlatest']);

            host = { projects: { locate: (id: string) => ({ projectId: 'p', folder: outside, canvasId: 'c', id }) } } as unknown as CanvasHost;
            expect((await call('project_ignored', {}))[0]).toStartWith('refused\tnot-a-repository\t');
        } finally {
            await rm(folder, { recursive: true, force: true });
            await rm(outside, { recursive: true, force: true });
        }
    });
});
