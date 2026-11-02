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

function titleOf(id: string): HTMLElement {
    return [...frameOf(id).querySelectorAll<HTMLElement>('header span')].findLast((span) => span.textContent === liveCanvas('main')!.nodes[id]!.title)!;
}

function surface(): HTMLElement {
    return canvas.page.host.querySelector<HTMLElement>('[data-canvas-surface]')!;
}

function bodyOf(id: string): HTMLElement {
    return frameOf(id).querySelector<HTMLElement>('[data-node-body]')!;
}

/* The events Chromium sends for a double-click: two presses, each a pointerdown and a mousedown that counts
   the clicks, then the double-click itself. A captured press sends its clicks to `clicksTo` instead. */
async function doubleClickAsChromium(element: Element, clicksTo: Element = element): Promise<void> {
    const at = { bubbles: true, cancelable: true, button: 0, pointerId: 1, clientX: 10, clientY: 10 };
    await act(async () => {
        for (const detail of [1, 2]) {
            element.dispatchEvent(new PointerEvent('pointerdown', at));
            element.dispatchEvent(new MouseEvent('mousedown', { ...at, detail }));
            element.dispatchEvent(new PointerEvent('pointerup', at));
            element.dispatchEvent(new MouseEvent('mouseup', { ...at, detail }));
            clicksTo.dispatchEvent(new MouseEvent('click', { ...at, detail }));
        }
        clicksTo.dispatchEvent(new MouseEvent('dblclick', { ...at, detail: 2 }));
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
    test('the button in the title bar zooms a small node in as far as the canvas goes and selects it', async () => {
        await clickOn(frameOf(SMALL.id).querySelector('header button[aria-label="Zoom to node"]'));
        expect(zoom()).toBe(4);
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
        expect(zoom()).toBe(4);

        await act(async () => liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 0.3 }));
        await doubleClick(titleOf(SMALL.id));
        expect(zoom()).toBe(0.3);
        expect(frameOf(SMALL.id).querySelector('header input')).not.toBeNull();
    });

    test('a double-click anywhere on a node without the keyboard zooms until it fills the view', async () => {
        await doubleClickAsChromium(bodyOf(LARGE.id));
        expect(zoom()).toBeCloseTo((1280 - 96) / 1800);
        expect(liveCanvas('main')!.selection).toEqual([LARGE.id]);
    });

    test('a double-click on a header the browser sends to the canvas zooms and places no text behind the node', async () => {
        await doubleClickAsChromium(frameOf(SMALL.id).querySelector('[data-header-space]')!, surface());
        expect(zoom()).toBe(4);
        expect(Object.keys(liveCanvas('main')!.texts)).toEqual([]);
    });

    test('a double-click on the title of a node without the keyboard zooms too', async () => {
        await doubleClickAsChromium(titleOf(SMALL.id));
        expect(zoom()).toBe(4);
        expect(frameOf(SMALL.id).querySelector('header input')).toBeNull();
    });

    test('a double-click in the node that has the keyboard stays its own, and one on its title renames', async () => {
        await act(async () => liveCanvas('main')!.activateNode(LARGE.id));
        await doubleClickAsChromium(bodyOf(LARGE.id));
        expect(zoom()).toBe(0.3);

        await doubleClickAsChromium(titleOf(LARGE.id));
        expect(zoom()).toBe(0.3);
        expect(frameOf(LARGE.id).querySelector('header input')).not.toBeNull();
    });

    test('a double-click on the empty canvas still places a text', async () => {
        await doubleClickAsChromium(surface());
        expect(Object.keys(liveCanvas('main')!.texts)).toHaveLength(1);
        expect(zoom()).toBe(0.3);
    });
});
