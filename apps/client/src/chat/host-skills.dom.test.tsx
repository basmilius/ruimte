import { afterEach, describe, expect, test } from 'bun:test';
import { EditorView } from '@codemirror/view';
import { REQUEST_SCHEMAS, type EndpointInfo, type ProjectView, type RequestType } from '@ruimte/contracts';
import { act } from 'react';
import { useServers } from '@/state/server';
import { startServerInfo } from '@/workspace/server-info';
import { chatInfoOf } from '../../testing/chat-info';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MACHINE = 'fake-machine';
const CLAUDE = claudeProvider({ chat: true, terminal: true, hooks: true, attachments: true, mentions: true, slashCommands: true });
const DESIGN = { name: 'ruimte-design', title: 'design', description: 'Designs pages beside the chat.' };

let lead: ProjectView;
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let stopInfo: () => void;

afterEach(async () => {
    stopInfo();
    await page.unmount();
    workspace.close();
});

async function open(id: string, answersSkills: boolean): Promise<void> {
    lead = { kind: 'chat', id, name: 'Lead', node: { provider: 'claude' } };
    machine = new FakeMachine();
    const info: EndpointInfo = { id: MACHINE, label: 'Fake machine', platform: 'darwin', version: '1', reachability: 'lan', authenticated: true };
    machine.answer('endpoint.info', () => info);
    machine.answer('provider.list', () => ({ providers: [CLAUDE] }) as never);
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('chat.send', () => ({ queued: false, turnId: 'turn-1' }));
    machine.answer('skill.list', () => ({ skills: [DESIGN] }));

    if (!answersSkills) {
        machine.answersOnly((Object.keys(REQUEST_SCHEMAS) as RequestType[]).filter((type) => type !== 'skill.list'));
    }

    workspace = await openFakeWorkspace(machine, { views: [lead] } as never, { activeViewId: lead.id, views: {} });
    stopInfo = startServerInfo();
    page = mount();
    await page.renderApp();
    await until(() => composer() !== null && useServers.getState().byEndpoint[MACHINE] !== undefined);
}

function composer(): EditorView | null {
    const content = page.host.querySelector(`[data-split-cell][data-view-id="${lead.id}"] .cm-content`);

    return content === null ? null : EditorView.findFromDOM(content as HTMLElement);
}

async function type(words: string): Promise<void> {
    await act(async () => {
        const view = composer()!;
        view.dispatch(view.state.replaceSelection(words), { userEvent: 'input.type' });
    });
}

function option(name: string): Element | null {
    return [...page.host.querySelectorAll('[role="option"]')].find((candidate) => candidate.textContent?.includes(name)) ?? null;
}

describe('a skill the machine ships, after $ in the composer', () => {
    test('shows as design, and picking and sending it puts its name in the text', async () => {
        await open('chat-host-skill', true);
        await until(() => machine.requests('skill.list').length > 0);
        await type('Make a page, $des');
        await until(() => option('design') !== null);
        await pressKey(composer()!.contentDOM, 'Enter');
        await pressKey(composer()!.contentDOM, 'Enter');
        await until(() => machine.requests('chat.send').length === 1);

        expect(machine.requests('chat.send')[0]!.text).toContain('$ruimte-design');
    });

    test('is not offered by a machine that ships none, which is never asked', async () => {
        await open('chat-host-skill-older', false);
        await type('Make a page, $des');
        await act(async () => {
            await Promise.resolve();
        });

        expect(option('design')).toBeNull();
        expect(machine.requests('skill.list')).toEqual([]);
    });
});
