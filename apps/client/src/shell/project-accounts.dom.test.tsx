import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { EventMap } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();

const ACCOUNTS: EventMap['accounts.changed']['accounts'] = {
    claude: { kind: 'claude', label: 'Personal' },
    claude_work: { kind: 'claude', label: 'Work', home: '~/.claude-work' },
    claude_client: { kind: 'claude', label: 'Client', home: '~/.claude-client' },
    codex: { kind: 'codex' }
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function dialog(): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((candidate) => candidate.textContent?.includes('Project settings')) ?? null;
}

function offerSwitch(account: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[aria-label="Offer ${account} in this project"]`);
}

async function open(accounts?: Record<string, { default?: string; off?: string[] }>): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN], ...(accounts ? { accounts } : {}) } as never, { activeViewId: 'main', views: {} } as never);
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().askProjectSettings(true));
    await until(() => dialog() !== null);
}

beforeEach(() => {
    machine = new FakeMachine();
    machine.answer('accounts.list', () => ({ accounts: ACCOUNTS, statuses: [] }));
    machine.answer('project.setAccounts', ({ kind, default: preferred, off }) => ({
        accounts: { [kind]: { ...(preferred ? { default: preferred } : {}), off } }
    }));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the accounts of a project', () => {
    test('lists a CLI with several accounts and turns one off for this project', async () => {
        await open();
        await until(() => offerSwitch('Client') !== null);
        expect(dialog()?.textContent).toContain('Only on this machine, for you.');
        expect(dialog()?.textContent).not.toContain('Codex');

        await clickOn(offerSwitch('Client'));
        await until(() => machine.requests('project.setAccounts').length > 0);
        expect(machine.requests('project.setAccounts')[0]).toMatchObject({ kind: 'claude', default: null, off: ['claude_client'] });
    });

    test("cannot turn off the project's default", async () => {
        await open({ claude: { default: 'claude_work' } });
        await until(() => offerSwitch('Work') !== null);
        expect(offerSwitch('Work')?.hasAttribute('data-disabled') || offerSwitch('Work')?.getAttribute('aria-disabled') === 'true').toBe(true);
    });

    test('is left out against a machine that keeps no accounts per project', async () => {
        machine.answersOnly(['accounts.list', 'project.open', 'project.save']);
        await open();
        await until(() => dialog() !== null);
        expect(offerSwitch('Client')).toBeNull();
    });
});
