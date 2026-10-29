import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [fakeProvider('claude', 'Claude Code'), fakeProvider('grok', 'Grok')] }));
    machine.answer('accounts.list', () => ({
        accounts: { claude: { kind: 'claude' }, grok: { kind: 'grok' } },
        statuses: [],
        loginCommands: { claude: 'claude /login', grok: 'grok login' },
        silentLogins: ['grok']
    }));
    // The terminal is not under test; a login that never starts keeps it quiet.
    machine.answer('session.login', () => new Promise(() => undefined));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    act(() => useUi.getState().setLogin(null));
    await page.unmount();
    workspace.close();
});

function dialogText(): string {
    return [...document.querySelectorAll('[role="dialog"]')].at(-1)?.textContent ?? '';
}

async function openLogin(kind: 'claude' | 'grok', name: string, sentence: string): Promise<string> {
    act(() => useUi.getState().setLogin({ endpointId: 'fake-machine', kind, accountId: kind, name }));
    await until(() => dialogText().includes(sentence));
    return dialogText();
}

describe('the login dialog', () => {
    test('says it closes by itself for a CLI the machine can ask about its login', async () => {
        const text = await openLogin('claude', 'Claude Code', 'This closes once you are logged in.');
        expect(text).not.toContain('Close this once');
    });

    test('asks a person to close it for a CLI whose login cannot report back', async () => {
        const text = await openLogin('grok', 'Grok', 'Close this once you are logged in.');
        expect(text).not.toContain('This closes once');
    });
});

describe('typing the code of a login over the settings', () => {
    let terminal: HTMLTextAreaElement;

    function written(): string {
        return machine
            .requests('session.write')
            .map((request) => request.data)
            .join('');
    }

    async function windowRefocused(): Promise<void> {
        await act(async () => {
            window.dispatchEvent(new FocusEvent('focus'));
            await new Promise((resolve) => requestAnimationFrame(resolve));
        });
    }

    beforeEach(async () => {
        machine.answer('session.login', ({ sessionId, cols, rows }) => ({ sessionId, cols, rows }) as never);
        act(() => useUi.getState().setSettings({ open: true, section: 'accounts' } as never));
        await until(() => document.querySelector('[role="dialog"]') !== null);
        await openLogin('claude', 'Claude Code', 'This closes once you are logged in.');
        await until(() => document.activeElement?.classList.contains('xterm-helper-textarea') === true);
        terminal = document.activeElement as HTMLTextAreaElement;
    });

    afterEach(() => {
        act(() => useUi.getState().setSettings({ open: false }));
    });

    test('a typed key and a paste reach the session', async () => {
        await act(async () => {
            terminal.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', keyCode: 65, bubbles: true, cancelable: true }));
            terminal.dispatchEvent(new KeyboardEvent('keypress', { key: 'a', charCode: 97, keyCode: 97, bubbles: true, cancelable: true }));
        });
        await until(() => written().includes('a'));

        const paste = new Event('paste', { bubbles: true, cancelable: true });
        Object.defineProperty(paste, 'clipboardData', { value: { getData: () => 'code-123' } });
        await act(async () => {
            terminal.dispatchEvent(paste);
        });
        await until(() => written().includes('code-123'));
    });

    test('a window that comes back with the focus on nothing gives it to the terminal', async () => {
        await act(async () => terminal.blur());
        expect(document.activeElement).toBe(document.body);

        await windowRefocused();
        expect(document.activeElement).toBe(terminal);
    });

    test('a window that comes back leaves the focus on a control that has it', async () => {
        const close = [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].at(-1)!.querySelector<HTMLElement>('button')!;
        await act(async () => close.focus());

        await windowRefocused();
        expect(document.activeElement).toBe(close);
    });
});
