import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Plan, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { claudeProvider } from '../../testing/fake-provider';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const CHAT: ProjectView = { kind: 'chat', id: 'chat-planned', name: 'Planner', node: { provider: 'claude' } } as ProjectView;
const PLAN: Plan = {
    id: 'plan-release',
    rev: 1,
    createdAt: '2026-11-04T09:00:00.000Z',
    meta: { title: 'Ship the release', kind: 'steps', checks: 'anyone' },
    items: [
        { type: 'step', id: 'migrate', title: 'Write the migration' },
        { type: 'step', id: 'test', title: 'Run the tests', state: 'done' }
    ]
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function pill(counter = '1/2'): HTMLElement | null {
    return ([...page.host.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent === counter) ?? null;
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [claudeProvider()] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('plan.list', () => ({ plans: [{ chatId: CHAT.id, plan: PLAN }] }));
    machine.answer('plan.apply', () => ({
        plan: { ...PLAN, rev: 2, items: PLAN.items.map((item) => (item.id === 'migrate' ? { ...item, state: 'done' as const } : item)) }
    }));
    workspace = await openFakeWorkspace(machine, { views: [CHAT] }, { activeViewId: CHAT.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => pill() !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('the plan panel', () => {
    test("a chat's plan pill opens its plan in the panel, with every step and its state", async () => {
        expect(page.host.textContent).not.toContain('Write the migration');
        await clickOn(pill());
        await until(() => page.host.textContent?.includes('Write the migration') === true);
        expect(page.host.textContent).toContain('Run the tests');
        expect(page.host.querySelector('button[aria-label="Open"]')).not.toBeNull();
        expect(page.host.querySelector('button[aria-label="Done"]')).not.toBeNull();
    });

    test('ticking a step shows it done at once and sends the change to the machine', async () => {
        await clickOn(pill());
        await until(() => page.host.querySelector('button[aria-label="Open"]') !== null);
        await clickOn(page.host.querySelector('button[aria-label="Open"]'));
        await until(() => machine.requests('plan.apply').length > 0);
        expect(machine.requests('plan.apply')[0]).toMatchObject({ chatId: CHAT.id, planId: PLAN.id });
        expect(JSON.stringify(machine.requests('plan.apply')[0]!.ops)).toContain('migrate');
        await until(() => pill('2/2') !== null && page.host.querySelector('button[aria-label="Open"]') === null);
        expect(page.host.querySelectorAll('button[aria-label="Done"]')).toHaveLength(2);
    });

    test('a plan the machine changes is drawn as it now is', async () => {
        await clickOn(pill());
        await until(() => page.host.textContent?.includes('Write the migration') === true);
        await act(async () => {
            machine.emit('plan.changed', {
                chatId: CHAT.id,
                plan: { ...PLAN, rev: 2, items: [...PLAN.items, { type: 'step', id: 'tag', title: 'Tag the release' }] }
            });
        });
        await until(() => page.host.textContent?.includes('Tag the release') === true);
        expect(machine.requests('plan.apply')).toEqual([]);
    });
});
