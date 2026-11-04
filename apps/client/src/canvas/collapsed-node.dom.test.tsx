import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { liveCanvas } from '@/state/canvas';
import { windowWorkspace } from '@/state/window';
import { openCanvasPage, savedNodes, type CanvasPage } from '../../testing/canvas-page';
import { clickOn, until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const REVIEW: ProjectNode = { id: 'review', kind: 'chat', title: 'Review', x: 0, y: 0, w: 480, h: 520 };
const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 800, y: 0, w: 400, h: 320 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [REVIEW, PLAN], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let canvas: CanvasPage;

function frame(): HTMLElement {
    return canvas.page.host.querySelector<HTMLElement>(`[data-node-id="${REVIEW.id}"]`)!;
}

function chevron(): HTMLElement | null {
    return frame().querySelector<HTMLElement>('header button[aria-label="Collapse node"], header button[aria-label="Expand node"]');
}

/* The pointer on the canvas at a world point (the camera is at the origin), and the ports it brings up. */
async function portsAt(x: number, y: number): Promise<string[]> {
    await act(async () => {
        canvas.page.host.querySelector('[data-canvas-surface]')!.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, clientX: x, clientY: y }));
        await new Promise((resolve) => requestAnimationFrame(resolve));
    });
    return [...canvas.page.host.querySelectorAll('[data-port]')].map((port) => port.getAttribute('data-port')!);
}

function savedReview(): ProjectNode | undefined {
    return savedNodes(machine).find((node) => node.id === REVIEW.id);
}

beforeEach(async () => {
    machine = new FakeMachine();
    canvas = await openCanvasPage(machine, [MAIN], REVIEW.id);
    await act(async () => {
        liveCanvas('main')!.setViewport({ w: 1280, h: 800 });
        liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 1 });
    });
});

afterEach(() => canvas.close());

describe('a node folded to its header', () => {
    test('folds from the chevron on its kind icon, saves that, takes no new line, opens again and undoes', async () => {
        // The chevron stands on the icon, shown on hover, and the keyboard reaches it all the time.
        expect(chevron()?.getAttribute('aria-label')).toBe('Collapse node');
        expect(chevron()!.tabIndex).not.toBe(-1);
        // Beside the port in the middle of its right side.
        expect(await portsAt(495, 260)).toContain(REVIEW.id);

        await clickOn(chevron());
        expect(liveCanvas('main')!.nodes[REVIEW.id]).toMatchObject({ collapsed: true, expandedHeight: 520, h: 40 });
        expect(frame().style.height).toBe('40px');
        expect(chevron()?.getAttribute('aria-label')).toBe('Expand node');
        // The body stays as it was under the header, out of reach.
        expect(frame().querySelector('[data-node-body]')!.hasAttribute('inert')).toBe(true);
        await act(async () => windowWorkspace()!.connection.projects.flush());
        await until(() => savedReview()?.collapsed === true);
        expect(savedReview()).toMatchObject({ collapsed: true, expandedHeight: 520, h: 40 });

        // No port near it, and no line to it either; the note beside it still offers one.
        expect(await portsAt(495, 20)).not.toContain(REVIEW.id);
        expect(await portsAt(785, 160)).toContain(PLAN.id);
        expect(liveCanvas('main')!.addEdge(PLAN.id, REVIEW.id)).toBeNull();

        await clickOn(chevron());
        expect(liveCanvas('main')!.nodes[REVIEW.id]).toMatchObject({ h: 520 });
        expect(liveCanvas('main')!.nodes[REVIEW.id]!.collapsed).toBeUndefined();
        expect(frame().style.height).toBe('520px');

        await act(async () => liveCanvas('main')!.undo());
        expect(liveCanvas('main')!.nodes[REVIEW.id]).toMatchObject({ collapsed: true, h: 40 });
        await act(async () => liveCanvas('main')!.undo());
        expect(liveCanvas('main')!.nodes[REVIEW.id]).toMatchObject({ h: 520 });
    });
});
