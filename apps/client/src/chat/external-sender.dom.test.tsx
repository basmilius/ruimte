import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ProjectView, TunnelState } from '@ruimte/contracts';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, layOutChat, mount, until, type Mounted } from '../../testing/dom';
import { everything, installDesktop, removeDesktop } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const CHAT: ProjectView = { kind: 'chat', id: 'chat-external-sender', name: 'Lead', node: { provider: 'claude' } };

const NOTE = {
    kind: 'note',
    id: 'note-1',
    turnId: null,
    createdAt: 1,
    level: 'info',
    text: 'MCP · Hosted bot sent a message: Check the build',
    message: { from: 'external-cred-1', title: 'MCP · Hosted bot', text: 'Check the build' }
};

const TUNNELS: TunnelState = {
    stage: 'running',
    message: null,
    hasToken: true,
    accounts: [{ id: 'acc-1', name: 'Bas' }],
    account: { id: 'acc-1', name: 'Bas' },
    zones: [],
    tunnel: { name: 'ruimte-studio-4f2a', created: true, runner: 'ruimte', others: [] },
    rows: [],
    mcp: { enabled: true, port: 4230 },
    clients: 1,
    suggestedMcpLabel: null
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let restoreLayout: () => void;

function senderChip(): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[data-chip]')].find((chip) => chip.textContent === 'MCP · Hosted bot') ?? null;
}

beforeEach(async () => {
    restoreLayout = layOutChat();
    installDesktop();
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [claudeProvider({ chat: true })] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: chatId === CHAT.id ? [NOTE] : [], seq: 1 }) as never);
    machine.answer('tunnel.state', () => TUNNELS);
    machine.answer('credential.list', () => ({ credentials: [] }));
    workspace = await openFakeWorkspace(machine, { views: [CHAT] } as never, { activeViewId: CHAT.id, views: {} }, {}, { thisMachine: true });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    removeDesktop();
    restoreLayout();
});

test('a message from an external MCP client names it under a plug and opens Tunnels in the settings', async () => {
    await until(() => senderChip() !== null);
    const chip = senderChip()!;

    expect(chip.querySelector('svg')?.getAttribute('class')).toContain('lucide-plug');
    expect(chip.getAttribute('role')).toBe('button');
    expect(everything()).not.toContain('Not in this project');

    await clickOn(chip);
    await until(() => document.querySelector('[role="dialog"]') !== null && everything().includes('Cloudflare'));

    expect(machine.requests('tunnel.state').length).toBeGreaterThan(0);
});
