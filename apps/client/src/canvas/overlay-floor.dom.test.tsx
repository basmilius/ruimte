import { afterEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { canvasOfNode } from '@/state/canvas';
import { useSettings } from '@/state/settings';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 400, h: 320 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PLAN], texts: [], edges: [], layouts: [] };

let canvas: CanvasPage | null = null;

const minimapBefore = useSettings.getState().canvasMinimap;

afterEach(async () => {
    await canvas?.close();
    canvas = null;
    useSettings.getState().update({ canvasMinimap: minimapBefore });
});

/* What `defineCanvasOverlay` documents to an extension: floors under the overlay box of the canvas. */
function floorsIn(host: HTMLElement): string[] {
    const overlay = host.querySelector('[data-canvas-overlay]');

    return [...(overlay?.querySelectorAll('[data-canvas-floor]') ?? [])].map((floor) => floor.getAttribute('data-canvas-floor') ?? '').sort();
}

describe('what stands at the bottom of a canvas', () => {
    test('marks the dock as a ledge and the minimap as a wall, in the box a canvas overlay is drawn in', async () => {
        canvas = await openCanvasPage(new FakeMachine(), [MAIN], PLAN.id);
        const { host } = canvas.page;

        // The minimap on, in a cell wide enough for it.
        await act(async () => {
            useSettings.getState().update({ canvasMinimap: true });
            canvasOfNode(PLAN.id)?.getState().setViewport({ w: 1280, h: 800 });
        });
        await until(() => floorsIn(host).length === 2);

        expect(floorsIn(host)).toEqual(['ledge', 'wall']);
    });
});
