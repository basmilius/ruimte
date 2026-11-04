import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { menuItem, openCanvasPage, openContextMenu, type CanvasPage } from '../../testing/canvas-page';
import { clickOn, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const REVIEW: ProjectNode = { id: 'review', kind: 'chat', title: 'Review', x: 0, y: 0, w: 480, h: 520 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [REVIEW], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let canvas: CanvasPage;

function dialog(): Element | null {
    return document.querySelector('[role="dialog"]');
}

function dialogButton(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="dialog"] button')] as HTMLElement[]).find((button) => button.textContent?.includes(text)) ?? null;
}

async function askToClear(): Promise<void> {
    await openContextMenu(canvas.page.host.querySelector(`[data-node-id="${REVIEW.id}"]`)!);
    await clickOn(menuItem('Clear'));
    await until(() => dialog() !== null);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('agent.children', () => ({ nodeIds: ['helper'] }));
    machine.answer('chat.clear', ({ chatId }) => ({ chatId }) as never);
    canvas = await openCanvasPage(machine, [MAIN], REVIEW.id);
});

afterEach(() => canvas.close());

describe('Clear on a chat node', () => {
    test('asks first, names the agents it ends, and a confirmation clears the chat once', async () => {
        await askToClear();
        expect(dialog()?.textContent).toContain('Clear Review?');
        expect(dialog()?.textContent).toContain('Also ends the agent it opened');
        expect(machine.requests('chat.clear')).toEqual([]);

        await clickOn(dialogButton('Clear'));
        await until(() => machine.requests('chat.clear').length === 1);
        expect(machine.requests('chat.clear')).toEqual([{ chatId: REVIEW.id, force: true }]);
    });

    test('cancelling sends nothing', async () => {
        await askToClear();
        await clickOn(dialogButton('Cancel'));

        await until(() => dialog() === null);
        expect(machine.requests('chat.clear')).toEqual([]);
    });
});
