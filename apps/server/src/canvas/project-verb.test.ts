import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { initRepo } from '../git/test-repo.ts';
import type { ProposalAnswer, ProposalAsk } from '../projects/project-proposals.ts';
import { type CanvasHost, type Noun, type Verb } from './verb.ts';
import { printed } from './verb-test-helpers.ts';
import { verbNamed } from './verbs.ts';

const noun = verbNamed('project') as Noun;

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

function run(argv: string[], caller = 'chat-1'): Promise<string[]> {
    return printed(noun, argv, { caller, host });
}

const PROPOSE = ['propose', '--name', 'Vinyl shelf', '--reason', 'The notes became a codebase'];

describe('ruimte-context project', () => {
    test('suggests a project and prints only what became of the card', async () => {
        expect(await run([...PROPOSE, '--folder', '/work/vinyl-shelf'])).toEqual(['proposal\tprop-1\tdeclined']);
        expect(asks).toEqual([{ chatId: 'chat-1', name: 'Vinyl shelf', folder: '/work/vinyl-shelf', reason: 'The notes became a codebase' }]);
    });

    test('prints every outcome', async () => {
        for (const outcome of ['declined', 'waiting'] as const) {
            answer = { proposalId: 'prop-1', outcome };
            expect((await run(PROPOSE))[0]).toBe(`proposal\tprop-1\t${outcome}`);
        }
        expect(asks.at(-1)).not.toHaveProperty('folder');
    });

    test('refuses a caller outside Chats, a relative folder and a missing flag, and asks nothing', async () => {
        expect((await run(PROPOSE, 'chat-in-project'))[0]).toStartWith('refused\tnot-in-chats\t');
        expect((await run([...PROPOSE, '--folder', 'vinyl-shelf']))[0]).toStartWith('refused\tfolder-not-absolute\t');
        expect((await run(PROPOSE.slice(0, 3)))[0]).toStartWith('refused\t');
        expect((await run(['propose', '--reason', 'x']))[0]).toStartWith('refused\t');
        expect((await run([...PROPOSE, '--wait', '30']))[0]).toStartWith('refused\t');
        expect(asks).toEqual([]);
    });

    test('help names every outcome and says the person decides', async () => {
        const help = await (verbNamed('help') as Verb).run(['project', 'propose'], { caller: 'chat-1', host });
        const text = help.join('\n');
        for (const word of ['declined', 'waiting', '--folder', 'next turn', 'closes the card', 'Nothing']) {
            expect(text).toContain(word);
        }
        expect(text).not.toContain('--wait');
        // A chat that moved is out of Chats and cannot suggest again, so no later suggestion can report it.
        expect(text).not.toContain('outcome\tmoved');
        // A card that lapsed or whose chat stopped is not reported either: the next suggestion simply raises a new one.
        expect(text).not.toContain('outcome\tcancelled');
    });
});

describe('project_ignored', () => {
    test('lists the files git ignores in the project, links apart, and refuses a folder outside a repository', async () => {
        const folder = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ignored-verb-')));
        const outside = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-ignored-none-')));
        try {
            await initRepo(folder, { '.gitignore': '.env\nlatest\n' });
            await writeFile(join(folder, '.env'), 'KEY=1\n');
            await symlink(join(folder, '.env'), join(folder, 'latest'));
            host = { projects: { locate: (id: string) => ({ projectId: 'p', folder, canvasId: 'c', id }) } } as unknown as CanvasHost;
            expect(await run(['ignored'])).toEqual([`root\t${folder}`, 'file\t.env\t6', 'link\tlatest']);
            host = { projects: { locate: (id: string) => ({ projectId: 'p', folder: outside, canvasId: 'c', id }) } } as unknown as CanvasHost;
            expect((await run(['ignored']))[0]).toStartWith('refused\tnot-a-repository\t');
        } finally {
            await rm(folder, { recursive: true, force: true });
            await rm(outside, { recursive: true, force: true });
        }
    });
});
