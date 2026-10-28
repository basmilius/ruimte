import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { liveCanvas } from '@/state/canvas';
import { useNotePreviews } from '@/state/note-previews';
import { FakeMachine } from '../../testing/fake-machine';
import { clickOn, openSubmenu, until } from '../../testing/dom';
import { menuItem, openCanvasPage, openContextMenu, type CanvasPage } from '../../testing/canvas-page';

const TEAM: ProjectNode = { id: 'team', kind: 'group', title: 'Team', x: 0, y: 0, w: 800, h: 600 };
const PLAN: ProjectNode = { id: 'plan', kind: 'note', title: 'Plan', body: '# Plan\n\nShip it', x: 1000, y: 0, w: 400, h: 320 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [TEAM, PLAN], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let canvas: CanvasPage;

function frameOf(id: string): HTMLElement {
    return canvas.page.host.querySelector<HTMLElement>(`[data-node-id="${id}"]`)!;
}

function lockButton(): HTMLElement | null {
    return frameOf(PLAN.id).querySelector<HTMLElement>('header button[aria-label="Lock to preview"], header button[aria-label="Unlock to edit"]');
}

function editor(): HTMLTextAreaElement | null {
    return frameOf(PLAN.id).querySelector('textarea');
}

beforeEach(async () => {
    machine = new FakeMachine();
    canvas = await openCanvasPage(machine, [MAIN], PLAN.id);
    await act(async () => {
        liveCanvas('main')!.setViewport({ w: 1280, h: 800 });
        liveCanvas('main')!.setCamera({ x: 0, y: 0, zoom: 1 });
    });
});

afterEach(async () => {
    await canvas.close();
    useNotePreviews.setState({ locked: {} });
});

describe('a right-click inside a group', () => {
    test('adds a node under New node at the click, which puts it in the group', async () => {
        await openContextMenu(frameOf(TEAM.id), { x: 300, y: 240 });
        await openSubmenu('New node');
        await clickOn(menuItem('Note'));
        await until(() => Object.keys(liveCanvas('main')!.nodes).length === 3);
        const added = Object.values(liveCanvas('main')!.nodes).find((node) => node.id !== TEAM.id && node.id !== PLAN.id)!;
        expect(added.kind).toBe('note');
        expect(added.x + added.w / 2).toBeGreaterThan(TEAM.x);
        expect(added.x + added.w / 2).toBeLessThan(TEAM.x + TEAM.w);
        expect(added.y + added.h / 2).toBeGreaterThan(TEAM.y);
        expect(added.y + added.h / 2).toBeLessThan(TEAM.y + TEAM.h);
    });

    test('offers no New node on a note', async () => {
        await openContextMenu(frameOf(PLAN.id));
        expect(menuItem('New node')).toBeNull();
    });
});

describe('a note locked to its preview', () => {
    test('stays rendered with the focus and maximized, and turns into the editor once unlocked', async () => {
        await clickOn(lockButton());
        expect(lockButton()?.getAttribute('aria-label')).toBe('Unlock to edit');
        await act(async () => liveCanvas('main')!.activateNode(PLAN.id));
        expect(editor()).toBeNull();
        expect(frameOf(PLAN.id).querySelector('h1')?.textContent).toBe('Plan');
        await act(async () => liveCanvas('main')!.toggleMaximizedNode(PLAN.id));
        expect(editor()).toBeNull();
        await clickOn(lockButton());
        await until(() => editor() !== null);
        expect(lockButton()?.getAttribute('aria-label')).toBe('Lock to preview');
    });
});
