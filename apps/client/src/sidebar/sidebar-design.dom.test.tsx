import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectView } from '@ruimte/contracts';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const DESIGN: ProjectView = {
    kind: 'design',
    id: 'design',
    name: 'Landing page',
    path: 'designs/landing',
    node: {},
    chats: [{ id: 'review', name: 'Codex 2', node: {} }]
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function row(id: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-sidebar-row="${id}"]`);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('chat.list', () => ({ chats: [{ chatId: 'review', status: 'needs-you' }] }) as never);
    workspace = await openFakeWorkspace(machine, { views: [DESIGN] }, { activeViewId: DESIGN.id, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('A design with several chats in the sidebar', () => {
    test('stays one row, with a later chat that waits under "Needs you"', async () => {
        await page.renderApp();
        await until(() => row('view:design') !== null && row('needs:review') !== null);

        expect(row('view:design')!.getAttribute('aria-expanded')).toBeNull();
        expect(row('node:design:review')).toBeNull();
        expect(row('needs:review')!.textContent).toContain('Codex 2');
        expect(row('needs:review')!.textContent).toContain('Landing page');
    });
});
