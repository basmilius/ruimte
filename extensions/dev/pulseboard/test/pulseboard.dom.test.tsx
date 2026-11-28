import { describe, expect, test } from 'bun:test';
import { createTestHost, createTestServer, type TestHostOptions } from '@ruimte/extension/testing';
import type { PulseboardServer } from '../server';

const NODES: NonNullable<TestHostOptions['project']>['nodes'] = [
    { id: 'chat-1', kind: 'chat', title: 'Import', agent: { status: 'idle' } },
    { id: 'chat-2', kind: 'chat', title: 'Search', agent: { status: 'running' } },
    { id: 'chat-3', kind: 'chat', title: 'Report', agent: { status: 'needsYou' } },
    { id: 'note-1', title: 'Plan' }
];
const LIMITS = [{ provider: 'claude', plan: 'max', windows: [{ label: '5h', used: 0.42, resetsAt: null }] }];

async function hostWith(options: TestHostOptions = {}, storage: Record<string, number> = {}) {
    const server = await createTestServer<PulseboardServer>({ storage });
    const host = await createTestHost({ project: { nodes: NODES }, ...options, answers: { server, 'usage.limits': LIMITS, ...options.answers } });

    return { host, server };
}

function voice(host: Awaited<ReturnType<typeof createTestHost>>): { run(input: object): Promise<string> } {
    return host.definitions.find((each) => each.kind === 'voiceAction')?.definition as never;
}

describe('Pulseboard', () => {
    test('lists the agents of the canvas in its card, the one that waits first, and goes to the one a person clicks', async () => {
        const { host } = await hostWith();
        const card = await host.render(host.card('now'));

        expect(card.text()).toBe('Report waits for youSearch worksImport is done');

        await card.click('Search works');

        expect(host.canvas.revealed()).toEqual(['chat-2']);

        host.setAgent('chat-2', { status: 'needsYou' });
        await card.until(() => card.find('Search waits for you') !== null);
    });

    test('says what a waiting chat waits on once the machine told, and nothing more without chats.read', async () => {
        const asked: unknown[] = [];
        const inspect = (input: unknown) => {
            asked.push(input);

            return {
                id: 'chat-3',
                title: 'Report',
                provider: 'claude',
                model: 'sonnet',
                mode: 'supervised',
                working: true,
                queued: 0,
                waitsOn: 'approval' as const,
                subagents: 0,
                background: 0
            };
        };
        const { host } = await hostWith({ answers: { 'machine.run': { 'chat.inspect': inspect } } });
        const card = await host.render(host.card('now'));

        await card.until(() => card.find('Report waits for your approval') !== null);

        // Only the one that waits is asked about.
        expect(asked).toEqual([{ chat: 'chat-3' }]);

        const refused = await hostWith({
            manifest: { permissions: { 'agents.status': 'Shows agents' } },
            answers: { 'machine.run': { 'chat.inspect': inspect } }
        });
        const plain = await refused.host.render(refused.host.card('now'));

        expect(plain.text()).toBe('Report waits for youSearch worksImport is done');
        expect(asked).toHaveLength(1);
    });

    test('fails its card without agents.status, as Ruimte does', async () => {
        const { host } = await hostWith({ manifest: { permissions: {} } });

        await expect(host.render(host.card('now'))).rejects.toThrow('Pulseboard did not ask for the permission agents.status in its manifest');
    });

    test('draws the activity with its charts, what the machine counted and the plan windows', async () => {
        const { host } = await hostWith({}, { chatTurns: 7, terminalTurns: 2 });
        const view = await host.render(host.view('activity'));

        expect(view.text()).toContain('1 of 3 agents work');
        expect(view.text()).toContain('This machine started 7 turns in chats and 2 in terminals');
        expect(view.text()).toContain('5 of 14 days reached the goal');
        expect(view.text()).toContain('claude, 5h: 42%');
        expect(view.container.querySelector('svg[aria-label="Turns a day over the last two weeks"], svg[role="img"]')).not.toBeNull();
        expect(view.text()).toContain('Morning');
    });

    test('keeps the goal with the project, the ended turns on this computer and the counts on the machine', async () => {
        const { host } = await hostWith({ storage: { project: { goal: 30 } } }, { chatTurns: 7 });
        const view = await host.render(host.view('activity'));

        expect(view.text()).toContain('Goal for this project: 30 turns a day');
        expect(view.text()).toContain('2 of 14 days reached the goal');

        await view.click('Fewer');
        host.fire('chat.turnFinished', { chatId: 'chat-2' });
        host.fire('chat.turnFinished', { chatId: 'chat-2' });
        await view.until(() => view.find('2 turns ended while this computer watched') !== null);

        expect(host.storage).toEqual({ computer: { finished: 2 }, project: { goal: 25 }, machine: { chatTurns: 7 } });
    });

    test('opens the activity from its command', async () => {
        const { host } = await hostWith();
        const command = host.definitions.find((each) => each.kind === 'command')?.definition as unknown as { run(): void };

        command.run();

        expect(host.opened).toEqual([{ kind: 'view', id: 'activity', params: undefined }]);
    });

    test('says by voice what the machine and this computer counted', async () => {
        const { host } = await hostWith({ storage: { computer: { finished: 4 } } }, { chatTurns: 7, terminalTurns: 2 });

        expect(await voice(host).run({})).toBe('The machine started 7 turns in chats and 2 in terminals. 4 ended while this computer watched.');
    });
});
