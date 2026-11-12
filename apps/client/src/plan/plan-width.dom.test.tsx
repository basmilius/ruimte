import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { Plan, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
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
    items: [{ type: 'step', id: 'migrate', title: 'Write the migration' }]
};

let workspace: FakeWorkspace;
let page: Mounted;
let before: {
    window: { width: number; height: number };
    ui: Pick<ReturnType<typeof useUi.getState>, 'planAnchor' | 'planOpen' | 'planWidth' | 'panelsRestoring'>;
};

function pill(): HTMLElement | null {
    return [...page.host.querySelectorAll<HTMLElement>('button')].find((button) => button.textContent === '0/1') ?? null;
}

function planPanel(): HTMLElement | null {
    return [...page.host.querySelectorAll<HTMLElement>('aside.sliding-column')].find((column) => column.textContent?.includes('Write the migration')) ?? null;
}

/* The width the plan is drawn at, without the gap beside it. */
function shownWidth(): number {
    return Number.parseInt(planPanel()?.querySelector<HTMLElement>(':scope > div')?.style.width ?? '', 10);
}

async function resizeWindow(width: number, height = 800): Promise<void> {
    await act(async () => {
        (window as unknown as { happyDOM: { setViewport(viewport: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height });
        window.dispatchEvent(new Event('resize'));
    });
}

beforeEach(async () => {
    const { planAnchor, planOpen, planWidth, panelsRestoring } = useUi.getState();
    before = { window: { width: window.innerWidth, height: window.innerHeight }, ui: { planAnchor, planOpen, planWidth, panelsRestoring } };

    const machine = new FakeMachine();
    machine.answer('provider.list', () => ({ providers: [claudeProvider()] }));
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq: 0 }) as never);
    machine.answer('plan.list', () => ({ plans: [{ chatId: CHAT.id, plan: PLAN }] }));
    workspace = await openFakeWorkspace(machine, { views: [CHAT] }, { activeViewId: CHAT.id, views: {} });
    page = mount();
    await page.renderApp();
    await resizeWindow(1280);
    await until(() => pill() !== null);
    await clickOn(pill());
    await until(() => planPanel() !== null);
    // What a drag of the panel's edge stores.
    await act(async () => useUi.getState().setPlanWidth(800));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    await resizeWindow(before.window.width, before.window.height);
    useUi.setState(before.ui);
});

describe('the width of the plan panel', () => {
    test('shrinks with a window made narrower, and is back at the dragged width once the window is wide again', async () => {
        expect(shownWidth()).toBe(800);

        await resizeWindow(900);

        expect(shownWidth()).toBe(540);
        expect(useUi.getState().planWidth).toBe(800);

        await resizeWindow(1280);

        expect(shownWidth()).toBe(800);
    });
});
