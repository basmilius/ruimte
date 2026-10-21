import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode, ProviderInfo } from '@ruimte/contracts';
import { windowWorkspace } from '@/state/window';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../testing/dom';

function providerOf(kind: string, name: string): ProviderInfo {
    return {
        kind,
        name,
        installed: true,
        version: '1.0.0',
        models: [{ slug: 'model', name: 'Model', legacy: false, isDefault: true, options: [] }],
        defaultModel: 'model',
        capabilities: { chat: true, terminal: true },
        resumeCommand: null
    } as unknown as ProviderInfo;
}

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function menuItems(): HTMLElement[] {
    return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')] as HTMLElement[];
}

function menuItem(text: string): HTMLElement | null {
    return menuItems().find((item) => item.textContent?.trim() === text) ?? null;
}

function savedNodes(): ProjectNode[] {
    const view = machine
        .requests('project.save')
        .at(-1)
        ?.content.views.find((candidate) => candidate.id === MAIN.id);
    return view?.kind === 'canvas' ? (view.nodes ?? []) : [];
}

async function openAgentChatMenu(): Promise<void> {
    await clickOn(page.host.querySelector('[aria-label="Add"]') as HTMLElement);
    await until(() => document.querySelector('[role="menu"]') !== null);
    await openSubmenu('Agent (Chat)');
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    machine.answer('provider.list', () => ({
        providers: [providerOf('claude', 'Claude Code'), providerOf('codex', 'Codex'), { ...providerOf('grok', 'Grok'), installed: false, version: null }]
    }));
    machine.answer('accounts.list', () => ({
        accounts: {
            claude: { kind: 'claude', label: 'Personal' },
            claude_work: { kind: 'claude', label: 'Work', home: '~/.claude-work' },
            claude_old: { kind: 'claude', label: 'Old', home: '~/.claude-old', enabled: false },
            codex: { kind: 'codex' }
        },
        statuses: []
    }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the agent submenu', () => {
    test('a CLI with several accounts offers each one that is on, and a CLI with one stays a row', async () => {
        await openAgentChatMenu();
        await until(() => menuItem('Work') !== null);
        const labels = menuItems().map((item) => item.textContent?.trim());
        expect(labels).toContain('Personal');
        expect(labels).toContain('Codex');
        expect(labels).not.toContain('Old');
        expect(labels).not.toContain('Claude Code');
        const groups = [...document.querySelectorAll('[role="menu"] [role="group"]')].map((group) => group.textContent);
        expect(groups.some((text) => text?.startsWith('Claude Code'))).toBe(true);
    });

    test('a CLI that is not installed is not offered', async () => {
        await openAgentChatMenu();
        await until(() => menuItem('Codex') !== null);
        expect(menuItems().map((item) => item.textContent?.trim())).not.toContain('Grok');
    });

    test('picking an account starts the chat on it', async () => {
        await openAgentChatMenu();
        await until(() => menuItem('Work') !== null);
        await clickOn(menuItem('Work'));
        await until(() => machine.requests('chat.create').length > 0);
        await act(async () => windowWorkspace()!.connection.projects.flush());
        expect(savedNodes().find((node) => node.kind === 'chat')).toMatchObject({ provider: 'claude', account: 'claude_work' });
    });
});
