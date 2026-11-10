import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { liveCanvas } from '@/state/canvas';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { pressKey, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 400, h: 320 };
const NOTES: ProjectNode = { id: 'notes', kind: 'note', title: 'Notes', body: 'Later', x: 800, y: 0, w: 400, h: 320 };

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [PLAN, NOTES],
    texts: [],
    edges: [{ id: 'line', from: PLAN.id, to: NOTES.id, label: 'context' }],
    layouts: []
};

let canvas: CanvasPage;

async function press(element: Element | null): Promise<void> {
    expect(element).not.toBeNull();
    await act(async () => {
        element!.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, clientX: 600, clientY: 160 }));
    });
}

function linePath(): Element | null {
    return canvas.page.host.querySelector('[data-edge-layer="lines"] path.cursor-pointer');
}

function lineLabel(): Element | null {
    return [...canvas.page.host.querySelectorAll('[data-edge-layer="labels"] span')].find((span) => span.textContent === 'context') ?? null;
}

beforeEach(async () => {
    canvas = await openCanvasPage(new FakeMachine(), [MAIN], (host) => host.querySelector('[data-edge-layer="lines"] path') !== null);
});

afterEach(() => canvas.close());

describe('a press on a line', () => {
    test.each([
        ['the line', linePath],
        ['its label', lineLabel]
    ])('on %s takes the keyboard back from a node, so Backspace removes the line', async (_, target) => {
        await act(async () => liveCanvas('main')!.setBodyFocus(PLAN.id));

        await press(target());
        expect(liveCanvas('main')!.selection).toEqual(['line']);

        await pressKey(document.body, 'Backspace');
        await until(() => liveCanvas('main')!.edges.length === 0);
        expect(Object.keys(liveCanvas('main')!.nodes).sort()).toEqual([NOTES.id, PLAN.id]);
    });
});
