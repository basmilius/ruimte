import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { canvasOfNode } from '@/state/canvas';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const NEAR: ProjectNode = { id: 'near', kind: 'note', title: 'Near', body: 'In sight', x: 0, y: 0, w: 320, h: 240 };
// More than a viewport past the right edge of a 1280 by 800 view at 100%.
const FAR: ProjectNode = { id: 'far', kind: 'note', title: 'Far away', body: 'Out of sight', x: 5000, y: 0, w: 320, h: 240 };
const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [NEAR, FAR],
    texts: [],
    edges: [{ id: 'line', from: NEAR.id, to: FAR.id }],
    layouts: []
};

let machine: FakeMachine;
let canvas: CanvasPage;

function frameOf(id: string): Element | null {
    return canvas.page.host.querySelector(`[data-node-id="${id}"]`);
}

function store() {
    return canvasOfNode(NEAR.id)!;
}

async function open(): Promise<void> {
    canvas = await openCanvasPage(machine, [MAIN], NEAR.id);
    // The page has no layout to measure, so the canvas gets the size a window would give it.
    await act(async () => {
        store().getState().setViewport({ w: 1280, h: 800 });
        store().getState().setCamera({ x: 0, y: 0, zoom: 1 });
    });
}

beforeEach(() => {
    machine = new FakeMachine();
});

afterEach(() => canvas.close());

describe('a note far from sight', () => {
    test('is left out of the page while its line is still drawn to it, and comes back once a pan nears it', async () => {
        await open();
        await until(() => frameOf(FAR.id) === null);
        expect(frameOf(NEAR.id)).not.toBeNull();
        // The line lands a gap short of the far note's left side, read off the node's geometry alone.
        const drawn = [...canvas.page.host.querySelectorAll('[data-edge-layer="lines"] path')].map((path) => path.getAttribute('d') ?? '');
        expect(drawn.some((d) => d.endsWith(`L ${FAR.x - 9} ${FAR.y + FAR.h / 2}`))).toBe(true);

        await act(async () => store().getState().setCamera({ x: -4000, y: 0, zoom: 1 }));
        await until(() => frameOf(FAR.id) !== null);
        expect(frameOf(FAR.id)?.textContent).toContain('Far away');
    });

    test('stays in the page while it is selected, the way a node an agent or a person acts on does', async () => {
        await open();
        await until(() => frameOf(FAR.id) === null);

        await act(async () => store().getState().select([FAR.id]));
        await until(() => frameOf(FAR.id) !== null);

        await act(async () => store().getState().clearSelection());
        await until(() => frameOf(FAR.id) === null);
    });
});
