import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { menuItem, openCanvasPage, openContextMenu, type CanvasPage } from '../../testing/canvas-page';
import { clickOn, openSubmenu, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const SHELL: ProjectNode = { id: 'shell', kind: 'terminal', title: 'Shell', x: 0, y: 0, w: 560, h: 360 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [SHELL], texts: [], edges: [], layouts: [] };
const FRAME = `[data-node-id="${SHELL.id}"]`;

let machine: FakeMachine;
let canvas: CanvasPage;

beforeEach(async () => {
    machine = new FakeMachine();
    canvas = await openCanvasPage(machine, [MAIN], SHELL.id);
});

afterEach(() => canvas.close());

describe('Clear on a terminal', () => {
    test('the menu of its frame clears the session once', async () => {
        await openContextMenu(canvas.page.host.querySelector(FRAME)!);
        await openSubmenu('Terminal');
        await clickOn(menuItem('Clear'));

        await until(() => machine.requests('session.clear').length === 1);
        expect(machine.requests('session.clear')).toEqual([{ sessionId: SHELL.id }]);
    });

    test('the menu inside the terminal clears the session once', async () => {
        await until(() => canvas.page.host.querySelector(`${FRAME} .bg-term-bg`) !== null);
        await openContextMenu(canvas.page.host.querySelector(`${FRAME} .bg-term-bg`)!);
        expect(menuItem('Paste')).not.toBeNull();
        await clickOn(menuItem('Clear'));

        await until(() => machine.requests('session.clear').length === 1);
        expect(machine.requests('session.clear')).toEqual([{ sessionId: SHELL.id }]);
    });
});
