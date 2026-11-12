import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const WIDTH_KEY = 'ruimte.sidebar.width';

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [{ id: 'notes', kind: 'note', title: 'Notes', text: '', x: 0, y: 0, w: 320, h: 240 } as ProjectNode],
    texts: [],
    edges: [],
    layouts: []
};

let machine: FakeMachine;
let canvas: CanvasPage;
let before: {
    window: { width: number; height: number };
    stored: string | null;
    ui: Pick<ReturnType<typeof useUi.getState>, 'sidebarOpen' | 'sidebarWidth' | 'panelsRestoring'>;
};

function sidebar(): HTMLElement {
    const column = canvas.page.host.querySelector<HTMLElement>('#app-sidebar');

    if (column === null) {
        throw new Error('The sidebar is not drawn.');
    }

    return column;
}

/* The width the list itself is drawn at, without the gap beside it. */
function shownWidth(): number {
    return Number.parseInt(sidebar().querySelector<HTMLElement>(':scope > div')?.style.width ?? '', 10);
}

async function resizeWindow(width: number, height = 800): Promise<void> {
    await act(async () => {
        (window as unknown as { happyDOM: { setViewport(viewport: { width: number; height: number }): void } }).happyDOM.setViewport({ width, height });
        window.dispatchEvent(new Event('resize'));
    });
}

/* Drags the sidebar's right edge `distance` pixels to the right. The page lays nothing out, so the column measures its own style. */
async function dragEdgeBy(distance: number): Promise<void> {
    const column = sidebar();
    const handle = column.querySelector<HTMLElement>('.sliding-column-resize');

    if (handle === null) {
        throw new Error('The sidebar has no edge to drag.');
    }

    const width = Number.parseInt(column.style.width, 10);
    const clientX = width + distance;
    column.getBoundingClientRect = () => ({ width, height: 800, x: 0, y: 0, top: 0, left: 0, right: width, bottom: 800, toJSON: () => ({}) });

    await act(async () => {
        handle.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, pointerId: 1, clientX: width }));
        handle.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, pointerId: 1, clientX }));
        handle.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, pointerId: 1, clientX }));
    });
}

beforeEach(async () => {
    const { sidebarOpen, sidebarWidth, panelsRestoring } = useUi.getState();
    before = {
        window: { width: window.innerWidth, height: window.innerHeight },
        stored: localStorage.getItem(WIDTH_KEY),
        ui: { sidebarOpen, sidebarWidth, panelsRestoring }
    };

    localStorage.removeItem(WIDTH_KEY);
    useUi.setState({ sidebarOpen: true, sidebarWidth: null });
    machine = new FakeMachine();
    canvas = await openCanvasPage(machine, [MAIN], 'notes');
    await until(() => canvas.page.host.querySelector('#app-sidebar') !== null);
});

afterEach(async () => {
    await canvas.close();
    await resizeWindow(before.window.width, before.window.height);

    if (before.stored === null) {
        localStorage.removeItem(WIDTH_KEY);
    } else {
        localStorage.setItem(WIDTH_KEY, before.stored);
    }

    useUi.setState(before.ui);
});

describe('the width of the sidebar', () => {
    test('stands at its default until a person drags it', () => {
        expect(shownWidth()).toBe(248);
    });

    test('follows a drag of its edge and keeps the width for the next window', async () => {
        await dragEdgeBy(72);

        expect(shownWidth()).toBe(320);
        expect(localStorage.getItem(WIDTH_KEY)).toBe('320');
    });

    test('stops a drag where the canvas beside it would get too narrow', async () => {
        await resizeWindow(700);
        await dragEdgeBy(2000);

        expect(shownWidth()).toBe(340);
        expect(localStorage.getItem(WIDTH_KEY)).toBe('340');
    });

    test('shows a stored width that does not fit within its bounds', async () => {
        await act(async () => useUi.setState({ sidebarWidth: 900 }));
        expect(shownWidth()).toBe(480);

        await act(async () => useUi.setState({ sidebarWidth: 120 }));
        expect(shownWidth()).toBe(200);
    });

    test('shrinks with a window made narrower, and is back at the dragged width once the window is wide again', async () => {
        await resizeWindow(1280);
        await dragEdgeBy(212);

        expect(shownWidth()).toBe(460);

        await resizeWindow(700);

        expect(shownWidth()).toBe(340);
        expect(useUi.getState().sidebarWidth).toBe(460);
        expect(localStorage.getItem(WIDTH_KEY)).toBe('460');

        await resizeWindow(1280);

        expect(shownWidth()).toBe(460);
    });
});
