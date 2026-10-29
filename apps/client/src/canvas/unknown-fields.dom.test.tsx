import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { windowWorkspace } from '@/state/window';
import { FakeMachine } from '../../testing/fake-machine';
import { pressKey, until } from '../../testing/dom';
import { openCanvasPage, savedNodes, type CanvasPage } from '../../testing/canvas-page';

// A key a newer Ruimte added: the types do not carry it, the file and the wire do.
const PLAN = { id: 'plan', kind: 'note', title: 'Plan', body: 'Ship it', x: 0, y: 0, w: 400, h: 320, location: { line: 3 } } as ProjectNode;
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [PLAN], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let canvas: CanvasPage;

beforeEach(() => {
    machine = new FakeMachine();
});

afterEach(() => canvas.close());

describe('a node with a field this version does not know', () => {
    test('renaming it saves the new title and the field as it was', async () => {
        canvas = await openCanvasPage(machine, [MAIN], PLAN.id);

        const title = [...canvas.page.host.querySelectorAll(`[data-node-id="${PLAN.id}"] header span`)].findLast((span) => span.textContent === 'Plan')!;
        await act(async () => {
            title.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        });
        await until(() => canvas.page.host.querySelector(`[data-node-id="${PLAN.id}"] input`) !== null);
        const input = canvas.page.host.querySelector<HTMLInputElement>(`[data-node-id="${PLAN.id}"] input`)!;
        await act(async () => {
            input.focus();
            // React tracks the value it set, so the browser's own setter is what makes the change show.
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Roadmap');
            input.dispatchEvent(new Event('input', { bubbles: true }));
        });
        await pressKey(input, 'Enter');
        await act(async () => windowWorkspace()!.connection.projects.flush());

        await until(() => machine.requests('project.save').length > 0);
        expect(savedNodes(machine)[0]).toMatchObject({ id: 'plan', title: 'Roadmap', location: { line: 3 } });
    });
});
