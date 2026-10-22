import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const WRITER: ProjectNode = { id: 'writer', kind: 'chat', title: 'Writer', x: 40, y: 80, w: 480, h: 520 };
const TEAM: ProjectNode = { id: 'team', kind: 'group', title: 'Team', x: 0, y: 0, w: 600, h: 700, memberIds: [WRITER.id] };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [TEAM, WRITER], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function groupBar(): Element | null {
    return page.host.querySelector(`[data-node-id="${TEAM.id}"] header`);
}

function needsYouOnBar(): boolean {
    return (groupBar()?.querySelector('[role="img"][aria-label="Needs you"]') ?? null) !== null;
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${WRITER.id}"]`) !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a collapsed group', () => {
    test('says on its bar that a chat it hides waits on you, and stops once the chat does', async () => {
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id, { status: 'needs-you' }) }));
        // Open, the chat shows its own mark and the bar adds none.
        expect(needsYouOnBar()).toBe(false);

        await clickOn(page.host.querySelector(`[data-node-id="${TEAM.id}"] button[aria-label="Collapse"]`));
        await until(() => page.host.querySelector(`[data-node-id="${WRITER.id}"]`) === null);
        expect(needsYouOnBar()).toBe(true);

        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        await until(() => !needsYouOnBar());
    });
});
