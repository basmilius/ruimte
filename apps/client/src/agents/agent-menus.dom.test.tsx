import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { EventMap, ProjectNode } from '@ruimte/contracts';
import { useProviderAccountsStore } from '@adecore/agents-react/state';
import { windowWorkspace } from '@/state/window';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../testing/dom';
import { emptyCanvas } from '../../testing/project-fixtures';

// The endpoint `openFakeWorkspace` puts the machine behind.
const FAKE_MACHINE = 'fake-machine';

const MAIN = emptyCanvas();

type ProviderAccounts = EventMap['accounts.changed'];
type Accounts = ProviderAccounts['accounts'];

// Claude Code's own account is on and one of its others is off.
const ACCOUNTS: Accounts = {
    claude: { kind: 'claude', label: 'Personal' },
    claude_work: { kind: 'claude', label: 'Work', home: '~/.claude-work' },
    claude_old: { kind: 'claude', label: 'Old', home: '~/.claude-old', enabled: false },
    codex: { kind: 'codex' }
};

// Claude Code's own account turned off in Providers and two others on.
const DEFAULT_OFF: Accounts = {
    claude: { kind: 'claude', label: 'Personal', enabled: false },
    claude_work: { kind: 'claude', label: 'Work', home: '~/.claude-work' },
    claude_side: { kind: 'claude', label: 'Side', home: '~/.claude-side' },
    codex: { kind: 'codex' }
};

let machine: FakeMachine;
let workspace: FakeWorkspace | null;
let page: Mounted | null;

/* The window on a machine with these accounts; `accounts.list` answers whatever `answer` hands back, so a test can keep it waiting. */
async function start(answer: () => ProviderAccounts | Promise<ProviderAccounts> = () => ({ accounts: ACCOUNTS, statuses: [] })): Promise<void> {
    machine.answer('accounts.list', answer);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
}

/* What the machine announces when a person turns an account on or off in Providers. */
async function accountsChange(accounts: Accounts): Promise<void> {
    await act(async () => machine.emit('accounts.changed', { accounts, statuses: [] }));
}

function menuItems(): HTMLElement[] {
    return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')] as HTMLElement[];
}

/* What a row says, without the hint a terminal row carries at its end. */
function labelOf(item: HTMLElement): string {
    const text = item.textContent ?? '';
    const hint = item.lastElementChild;
    return (hint?.tagName === 'SPAN' ? text.slice(0, text.length - (hint.textContent ?? '').length) : text).trim();
}

/* The rows of the submenu that is open, the last menu on the page. */
function submenuRows(): HTMLElement[] {
    const menu = [...document.querySelectorAll('[role="menu"]')].at(-1);
    return menu === undefined ? [] : ([...menu.querySelectorAll('[role="menuitem"]')] as HTMLElement[]);
}

function submenuSeparators(): number {
    return [...document.querySelectorAll('[role="menu"]')].at(-1)?.querySelectorAll('[role="separator"]').length ?? 0;
}

function submenuLabels(): string[] {
    return submenuRows().map(labelOf);
}

function menuItem(text: string): HTMLElement | null {
    return submenuRows().find((item) => labelOf(item) === text) ?? menuItems().find((item) => item.textContent?.trim() === text) ?? null;
}

/* The account rows under one CLI's name. */
function groupRows(provider: string): string[] {
    const group = [...document.querySelectorAll('[role="menu"] [role="group"]')].find((candidate) => candidate.textContent?.startsWith(provider));
    return group === undefined ? [] : ([...group.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).map(labelOf);
}

function savedNodes(): ProjectNode[] {
    const view = machine
        .requests('project.save')
        .at(-1)
        ?.content.views.find((candidate) => candidate.id === MAIN.id);
    return view?.kind === 'canvas' ? (view.nodes ?? []) : [];
}

type Surface = 'dock' | 'canvas' | 'sidebar';

/* One of the agent submenus, opened from the dock, from a right-click on the canvas or from the sidebar's New view. */
async function openAgentMenu(target: 'Agent (Chat)' | 'Agent (Terminal)', from: Surface = 'dock'): Promise<void> {
    if (from === 'canvas') {
        const surface = page!.host.querySelector('[data-canvas-surface]')!;
        await act(async () => {
            surface.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 400, clientY: 300, button: 2 }));
        });
    } else if (from === 'sidebar') {
        await clickOn(([...page!.host.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === 'New view') ?? null);
    } else {
        await clickOn(page!.host.querySelector('[aria-label="Add"]') as HTMLElement);
    }
    await until(() => document.querySelector('[role="menu"]') !== null);
    await openSubmenu(target);
}

/* Picks a row and waits for the node it made to be saved. */
async function pick(label: string, kind: 'chat' | 'terminal'): Promise<ProjectNode | undefined> {
    await clickOn(menuItem(label));
    if (kind === 'chat') {
        await until(() => machine.requests('chat.create').length > 0);
    }
    await act(async () => windowWorkspace()!.connection.projects.flush());
    await until(() => savedNodes().some((node) => node.kind === kind));
    return savedNodes().find((node) => node.kind === kind);
}

beforeEach(() => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    machine.answer('provider.list', () => ({
        providers: [fakeProvider('claude', 'Claude Code'), fakeProvider('codex', 'Codex'), fakeProvider('grok', 'Grok', { installed: false, version: null })]
    }));
    workspace = null;
    page = null;
});

afterEach(async () => {
    await page?.unmount();
    workspace?.close();
    // The next test's window has not heard from the machine yet either.
    useProviderAccountsStore.getState().forget(FAKE_MACHINE);
});

describe('the agent submenu', () => {
    test('a CLI with several accounts offers each one that is on, and a CLI with one stays a row', async () => {
        await start();
        await openAgentMenu('Agent (Chat)');
        await until(() => menuItem('Work') !== null);
        const labels = menuItems().map((item) => item.textContent?.trim());
        expect(labels).toContain('Personal');
        expect(labels).toContain('Codex');
        expect(labels).not.toContain('Old');
        expect(labels).not.toContain('Claude Code');
        const groups = [...document.querySelectorAll('[role="menu"] [role="group"]')].map((group) => group.textContent);
        expect(groups.some((text) => text?.startsWith('Claude Code'))).toBe(true);
    });

    test('lists the frontier labs, the other CLIs and the API providers by name, a line between groups, whatever order the machine sends', async () => {
        machine.answer('provider.list', () => ({
            providers: [
                fakeProvider('nanogpt', 'NanoGPT'),
                fakeProvider('grok', 'Grok'),
                fakeProvider('codex', 'Codex'),
                fakeProvider('anthropic-claude-api', 'Claude API'),
                fakeProvider('antigravity', 'Antigravity'),
                fakeProvider('claude', 'Claude Code')
            ]
        }));
        await start(() => ({ accounts: { claude: { kind: 'claude' }, codex: { kind: 'codex' } }, statuses: [] }));
        await openAgentMenu('Agent (Chat)');
        await until(() => menuItem('Grok') !== null);
        const menu = [...document.querySelectorAll('[role="menu"]')].at(-1)!;
        const rows = [...menu.querySelectorAll('[role="menuitem"], [role="separator"]')].map((node) =>
            node.getAttribute('role') === 'separator' ? '--' : labelOf(node as HTMLElement)
        );
        expect(rows).toEqual(['Claude Code', 'Codex', '--', 'Antigravity', 'Grok', '--', 'Claude API', 'NanoGPT']);
    });

    test('a CLI that is not installed is not offered', async () => {
        await start();
        await openAgentMenu('Agent (Chat)');
        await until(() => menuItem('Codex') !== null);
        expect(menuItems().map((item) => item.textContent?.trim())).not.toContain('Grok');
    });

    test('picking an account starts the chat on it', async () => {
        await start();
        await openAgentMenu('Agent (Chat)');
        await until(() => menuItem('Work') !== null);
        expect(await pick('Work', 'chat')).toMatchObject({ provider: 'claude', account: 'claude_work' });
    });
});

describe('a turned-off default account', () => {
    for (const target of ['Agent (Chat)', 'Agent (Terminal)'] as const) {
        test(`${target} lists only the accounts that are on`, async () => {
            await start(() => ({ accounts: DEFAULT_OFF, statuses: [] }));
            await openAgentMenu(target);
            await until(() => groupRows('Claude Code').length > 0);
            expect(groupRows('Claude Code')).toEqual(['Side', 'Work']);
            expect(submenuLabels()).not.toContain('Personal');
            // The group stands apart from the row of Codex.
            expect(submenuSeparators()).toBe(1);
        });
    }

    for (const from of ['dock', 'canvas', 'sidebar'] as const) {
        test(`picking an account from the ${from} starts the chat on it`, async () => {
            await start(() => ({ accounts: DEFAULT_OFF, statuses: [] }));
            await openAgentMenu('Agent (Chat)', from);
            await until(() => menuItem('Side') !== null);
            expect(groupRows('Claude Code')).toEqual(['Side', 'Work']);
            await clickOn(menuItem('Side'));
            await until(() => machine.requests('chat.create').length > 0);
            expect(machine.requests('chat.create')[0]).toMatchObject({ provider: 'claude', account: 'claude_side' });
        });
    }

    test('picking an account in Agent (Terminal) starts the terminal on it', async () => {
        await start(() => ({ accounts: DEFAULT_OFF, statuses: [] }));
        await openAgentMenu('Agent (Terminal)');
        await until(() => menuItem('Work') !== null);
        expect(await pick('Work', 'terminal')).toMatchObject({ provider: 'claude', account: 'claude_work' });
    });
});

describe('the number of accounts that are on', () => {
    test('with one other account left, the CLI is one row that names it and starts on it', async () => {
        await start(() => ({ accounts: { ...DEFAULT_OFF, claude_side: { ...DEFAULT_OFF.claude_side!, enabled: false } }, statuses: [] }));
        await openAgentMenu('Agent (Chat)');
        await until(() => menuItem('Claude Code (Work)') !== null);
        expect(groupRows('Claude Code')).toEqual([]);
        expect(submenuLabels()).toEqual(['Claude Code (Work)', 'Codex']);
        expect(submenuSeparators()).toBe(0);
        expect(await pick('Claude Code (Work)', 'chat')).toMatchObject({ provider: 'claude', account: 'claude_work' });
    });

    test('with only the default account on, the CLI is one row under its own name that still names the account', async () => {
        await start();
        await openAgentMenu('Agent (Chat)');
        await until(() => menuItem('Codex') !== null);
        expect(await pick('Codex', 'chat')).toMatchObject({ provider: 'codex', account: 'codex' });
    });

    test('with none on, the CLI has no row', async () => {
        const off = Object.fromEntries(
            Object.entries(DEFAULT_OFF).map(([id, account]) => [id, account.kind === 'claude' ? { ...account, enabled: false } : account])
        );
        await start(() => ({ accounts: off, statuses: [] }));
        await openAgentMenu('Agent (Chat)');
        await until(() => menuItem('Codex') !== null);
        expect(submenuLabels()).toEqual(['Codex']);
        expect(submenuSeparators()).toBe(0);
    });

    test('with no CLI left, the menu offers to set up agents', async () => {
        const off = Object.fromEntries(Object.entries(DEFAULT_OFF).map(([id, account]) => [id, { ...account, enabled: false }]));
        await start(() => ({ accounts: off, statuses: [] }));
        await openAgentMenu('Agent (Chat)');
        await until(() => submenuLabels().includes('Set up agents'));
        expect(submenuLabels()).toEqual(['Set up agents']);
    });

    test('a machine that keeps no accounts starts each CLI under its own login', async () => {
        await start(() => ({ accounts: {}, statuses: [] }));
        await openAgentMenu('Agent (Chat)');
        await until(() => menuItem('Codex') !== null);
        expect(submenuLabels()).toEqual(['Claude Code', 'Codex']);
        await clickOn(menuItem('Claude Code'));
        await until(() => machine.requests('chat.create').length > 0);
        expect(machine.requests('chat.create')[0]?.account).toBeUndefined();
    });
});

describe('while the accounts load', () => {
    test('the menu says it is connecting and offers no start until they are in', async () => {
        let answer: (accounts: ProviderAccounts) => void = () => {};
        await start(() => new Promise((resolve) => (answer = resolve)));
        await openAgentMenu('Agent (Chat)');
        await until(() => submenuLabels().includes('Connecting…'));
        expect(submenuLabels()).toEqual(['Connecting…']);
        expect(submenuRows()[0]?.getAttribute('aria-disabled')).toBe('true');

        await act(async () => answer({ accounts: DEFAULT_OFF, statuses: [] }));
        await until(() => groupRows('Claude Code').length > 0);
        expect(groupRows('Claude Code')).toEqual(['Side', 'Work']);
        expect(submenuLabels()).not.toContain('Connecting…');
    });
});

describe('turning an account off while the menu is open', () => {
    test('the rows follow', async () => {
        await start(() => ({ accounts: DEFAULT_OFF, statuses: [] }));
        await openAgentMenu('Agent (Chat)');
        await until(() => groupRows('Claude Code').length === 2);

        await accountsChange({ ...DEFAULT_OFF, claude_side: { ...DEFAULT_OFF.claude_side!, enabled: false } });
        await until(() => menuItem('Claude Code (Work)') !== null);
        expect(groupRows('Claude Code')).toEqual([]);

        await accountsChange({ ...DEFAULT_OFF, claude: { ...DEFAULT_OFF.claude!, enabled: true } });
        await until(() => groupRows('Claude Code').length === 3);
        expect(groupRows('Claude Code')).toEqual(['Personal', 'Side', 'Work']);
    });
});

describe("a project's accounts", () => {
    test('the menu leaves out what the project turned off, tags its default, and a pick starts on it', async () => {
        machine.answer('accounts.list', () => ({ accounts: { ...DEFAULT_OFF, claude: { kind: 'claude', label: 'Personal' } }, statuses: [] }));
        workspace = await openFakeWorkspace(
            machine,
            { views: [MAIN], accounts: { claude: { default: 'claude_work', off: ['claude_side'] } } },
            { activeViewId: MAIN.id, views: {} }
        );
        page = mount();
        await page.renderApp();
        await openAgentMenu('Agent (Chat)');
        await until(() => groupRows('Claude Code').length > 0);

        expect(groupRows('Claude Code')).toEqual(['Personal', 'WorkProject default']);
        expect(await pick('WorkProject default', 'chat')).toMatchObject({ provider: 'claude', account: 'claude_work' });
    });
});
