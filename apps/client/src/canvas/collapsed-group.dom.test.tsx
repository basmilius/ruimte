import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { chatInfoOf } from '../../testing/chat-info';
import { clickOn, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const WRITER: ProjectNode = { id: 'writer', kind: 'chat', title: 'Writer', x: 40, y: 80, w: 480, h: 520 };
const TEAM: ProjectNode = { id: 'team', kind: 'group', title: 'Team', x: 0, y: 0, w: 600, h: 700, memberIds: [WRITER.id] };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [TEAM, WRITER], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let canvas: CanvasPage;

function groupBar(): Element | null {
    return canvas.page.host.querySelector(`[data-node-id="${TEAM.id}"] header`);
}

function needsYouOnBar(): boolean {
    return (groupBar()?.querySelector('[role="img"][aria-label="Needs you"]') ?? null) !== null;
}

beforeEach(async () => {
    machine = new FakeMachine();
    canvas = await openCanvasPage(machine, [MAIN], WRITER.id);
});

afterEach(() => canvas.close());

describe('a collapsed group', () => {
    test('says on its bar that a chat it hides waits on you, and stops once the chat does', async () => {
        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id, { status: 'needs-you' }) }));
        // Open, the chat shows its own mark and the bar adds none.
        expect(needsYouOnBar()).toBe(false);

        await clickOn(canvas.page.host.querySelector(`[data-node-id="${TEAM.id}"] button[aria-label="Collapse"]`));
        await until(() => canvas.page.host.querySelector(`[data-node-id="${WRITER.id}"]`) === null);
        expect(needsYouOnBar()).toBe(true);

        await act(async () => machine.emit('chat.status', { chatId: WRITER.id, info: chatInfoOf(WRITER.id) }));
        await until(() => !needsYouOnBar());
    });
});
