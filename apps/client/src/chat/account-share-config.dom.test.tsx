import { afterEach, describe, expect, test } from 'bun:test';
import type { EventMap } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { fakeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const LABEL = 'Use the setup of the default account';

type ProviderAccounts = EventMap['accounts.changed'];

const ACCOUNTS: ProviderAccounts = {
    accounts: {
        claude: { kind: 'claude', label: 'Personal' },
        claude_work: { kind: 'claude', label: 'Work', home: '~/.claude-work' },
        codex: { kind: 'codex' },
        codex_side: { kind: 'codex', label: 'Side', home: '~/.codex-side' }
    },
    statuses: [],
    sharedConfigKinds: ['claude']
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function start(prepare?: (fake: FakeMachine) => void): Promise<void> {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [fakeProvider('claude', 'Claude Code'), fakeProvider('codex', 'Codex')] }));
    machine.answer('accounts.list', () => ACCOUNTS);
    prepare?.(machine);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    act(() => useUi.getState().setSettings({ open: true, section: 'providers' } as never));
    await until(() => document.querySelector('[role="dialog"]') !== null);
}

afterEach(async () => {
    act(() => useUi.getState().setSettings({ open: false, section: 'appearance', target: null }));
    await page.unmount();
    workspace.close();
});

function dialog(): Element {
    return [...document.querySelectorAll('[role="dialog"]')].at(-1)!;
}

/* The account's row in the list of providers, which opens its page; a row also says "Default" after its name. */
function accountRow(name: string): Element | undefined {
    return [...dialog().querySelectorAll('button')].find((element) => element.textContent?.trim().startsWith(name) === true);
}

async function openAccount(name: string): Promise<void> {
    await until(() => accountRow(name) !== undefined);
    await clickOn(accountRow(name)!);
}

function shareSwitch(): HTMLElement | null {
    return dialog().querySelector(`[role="switch"][aria-label="${LABEL}"]`);
}

describe('sharing the setup of the default account', () => {
    test('an extra Claude account has the switch and sends the request when it is turned on', async () => {
        await start((fake) => {
            fake.answer('accounts.shareConfig', ({ id, shared }) => ({
                ...ACCOUNTS,
                accounts: { ...ACCOUNTS.accounts, [id]: { ...ACCOUNTS.accounts[id]!, shareConfig: shared } }
            }));
        });
        await openAccount('Work');
        await until(() => shareSwitch() !== null);
        expect(dialog().textContent).toContain('Instructions, skills, agents and commands come from the default');
        expect(shareSwitch()?.getAttribute('aria-checked')).toBe('false');

        await clickOn(shareSwitch());

        await until(() => machine.requests('accounts.shareConfig').length === 1);
        expect(machine.requests('accounts.shareConfig')).toEqual([{ id: 'claude_work', shared: true }]);
        await until(() => shareSwitch()?.getAttribute('aria-checked') === 'true');
    });

    test('the default account and an extra account of another CLI have no switch', async () => {
        await start();
        await openAccount('Personal');
        await until(() => dialog().textContent?.includes('Remove') === true);
        expect(shareSwitch()).toBeNull();

        await openAccount('Side');
        await until(() => dialog().textContent?.includes('Side') === true);
        expect(shareSwitch()).toBeNull();
    });

    test('a machine that does not answer the request has no switch', async () => {
        await start((fake) => fake.answersOnly(['accounts.list', 'accounts.save', 'accounts.reorder', 'provider.list']));
        await openAccount('Work');
        await until(() => dialog().textContent?.includes('Remove') === true);
        expect(shareSwitch()).toBeNull();
    });
});
