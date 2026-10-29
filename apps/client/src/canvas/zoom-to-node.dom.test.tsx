import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { liveCanvas } from '@/state/canvas';
import { FakeMachine } from '../../testing/fake-machine';
import { clickOn, openSubmenu } from '../../testing/dom';
import { menuItem, openCanvasPage, openContextMenu, type CanvasPage } from '../../testing/canvas-page';

const SMALL: ProjectNode = { id: 'small', kind: 'note', title: 'Small', body: 'Hi', x: 2000, y: 0, w: 200, h: 100 };
const LARGE: ProjectNode = { id: 'large', kind: 'note', title: 'Large', body: 'Hello', x: 0, y: 0, w: 1800, h: 1000 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [SMALL, LARGE], texts: [], edges: [], layouts: [] };

let canvas: CanvasPage;

function frameOf(id: string): HTMLElement {
    return canvas.page.host.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
}

function zoom(): number {
    return liveCanvas('main')!.camera.zoom;
}

async function doubleClick(element: Element): Promise<void> {
    await act(async () => {
        element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
    });
}

beforeEach(async () => {
    canvas = await openCanvasPage(new FakeMachine(), [MAIN], SMALL.id);
    await act(async () => {
        liveCanvas('main')!.setViewport({ w: 1280, h: 800 });
        liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 0.3 });
    });
});

afterEach(() => canvas.close());

describe('zoom to node', () => {
    test('the button in the title bar zooms a small node in to 100% and selects it', async () => {
        await clickOn(frameOf(SMALL.id).querySelector('header button[aria-label="Zoom to node"]'));
        expect(zoom()).toBe(1);
        expect(liveCanvas('main')!.selection).toEqual([SMALL.id]);
    });

    test('the node menu zooms a large node out until it fits', async () => {
        await openContextMenu(frameOf(LARGE.id));
        await openSubmenu('Size and position');
        await clickOn(menuItem('Zoom to node'));
        expect(zoom()).toBeCloseTo((1280 - 96) / 1800);
    });

    test('a double-click on the empty title bar zooms, and one on the title still renames', async () => {
        await doubleClick(frameOf(SMALL.id).querySelector('[data-header-space]')!);
        expect(zoom()).toBe(1);

        await act(async () => liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 0.3 }));
        await doubleClick([...frameOf(SMALL.id).querySelectorAll('header span')].findLast((span) => span.textContent === 'Small')!);
        expect(zoom()).toBe(0.3);
        expect(frameOf(SMALL.id).querySelector('header input')).not.toBeNull();
    });
});
