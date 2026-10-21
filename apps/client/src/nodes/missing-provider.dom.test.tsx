import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode, ProviderInfo } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const GROK = {
    kind: 'grok',
    name: 'Grok',
    installed: false,
    version: null,
    models: [],
    defaultModel: null,
    capabilities: { chat: true, terminal: true },
    resumeCommand: 'grok {flags} --resume {id}',
    install: {
        description: "xAI's coding agent, in a terminal and in a chat.",
        commands: { darwin: 'curl -fsSL https://x.ai/cli/install.sh | bash' },
        signIn: [{ kind: 'command', command: 'grok login' }]
    }
} as unknown as ProviderInfo;

function terminal(id: string, provider: string): ProjectNode {
    return { id, kind: 'terminal', title: provider, provider, x: 0, y: 0, w: 560, h: 360 } as ProjectNode;
}

function canvas(nodes: ProjectNode[]): ProjectCanvasView {
    return { kind: 'canvas', id: 'main', name: 'Main', nodes, texts: [], edges: [], layouts: [] };
}

function button(label: string): HTMLButtonElement | null {
    return [...document.querySelectorAll('button')].find((element) => element.textContent?.trim() === label) ?? null;
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(views: unknown[], activeViewId: string, grok: ProviderInfo = GROK): Promise<void> {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    machine.answer('provider.list', () => ({ providers: [grok] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId, { provider: 'grok' }), items: [], seq: 0 }) as never);
    workspace = await openFakeWorkspace(machine, { views } as never, { activeViewId, views: {} });
    page = mount();
    await page.renderApp();
}

afterEach(async () => {
    // The store outlives the page, and the next file would open on these settings.
    useUi.getState().setSettings({ open: false, section: 'appearance', target: null });
    await page.unmount();
    workspace.close();
});

describe('a node whose CLI is not on its machine', () => {
    test('a terminal says so and leads to the install in Settings, Providers', async () => {
        await open([canvas([terminal('grok-term', 'grok')])], 'main');
        const node = (): Element | null => page.host.querySelector('[data-node-id="grok-term"]');
        await until(() => node()?.textContent?.includes('Grok is not installed on this machine.') === true);
        const install = [...(node()?.querySelectorAll('button') ?? [])].find((element) => element.textContent?.trim() === 'Install');
        expect(install).toBeDefined();
        await clickOn(install!);
        await until(() => document.querySelector('[role="dialog"]')?.textContent?.includes('Not installed') === true);
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Grok');
    });

    test('a chat view says so as well', async () => {
        await open([{ kind: 'chat', id: 'grok-chat', name: 'Grok', node: { provider: 'grok' } }], 'grok-chat');
        await until(() => page.host.querySelector('[data-view-id="grok-chat"]')?.textContent?.includes('Grok is not installed on this machine.') === true);
        expect(button('Install')).not.toBeNull();
    });

    test('a CLI this machine does not offer at all is named, with nothing to install', async () => {
        await open([canvas([terminal('old-agent', 'gemini')])], 'main');
        const node = (): Element | null => page.host.querySelector('[data-node-id="old-agent"]');
        await until(() => node()?.textContent?.includes('gemini is not available on this machine.') === true);
        expect(button('Install')).toBeNull();
    });

    test('an installed CLI says nothing', async () => {
        await open([canvas([terminal('grok-term', 'grok')])], 'main', { ...GROK, installed: true, version: '0.1.42' });
        await until(() => page.host.querySelector('[data-node-id="grok-term"] textarea') !== null);
        await until(() => machine.requests('provider.list').length > 0);
        expect(page.host.querySelector('[data-node-id="grok-term"]')?.textContent).not.toContain('is not installed');
    });
});
