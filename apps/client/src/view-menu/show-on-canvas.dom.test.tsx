import { afterEach, expect, test } from 'bun:test';
import type { ProjectCanvasView, ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { useDocument } from '@/state/document';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };
const NOTES: ProjectView = { kind: 'chat', id: 'notes', name: 'Vinyl notes', node: {} };

let workspace: FakeWorkspace;
let page: Mounted;

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

function mainNodeIds(): string[] {
    const main = useDocument
        .getState()
        .exportViews()
        .find((view) => view.id === MAIN.id);

    return main?.kind === 'canvas' ? main.nodes.map((node) => node.id) : [];
}

test('the first action of a window that starts in a project runs in the turn it is asked', async () => {
    workspace = await openFakeWorkspace(new FakeMachine(), { views: [MAIN, NOTES] }, { activeViewId: NOTES.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-sidebar-row="view:${NOTES.id}"]`) !== null);
    await act(async () => {
        page.host
            .querySelector(`[data-sidebar-row="view:${NOTES.id}"]`)!
            .dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);

    const show = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find((item) => item.textContent?.trim() === 'Show on canvas') ?? null;

    expect(show).not.toBeNull();

    // No turn waited between the click and the look: the canvas is in front and the chat is on it.
    act(() => show?.click());

    expect(useDocument.getState().activeViewId).toBe(MAIN.id);
    expect(mainNodeIds()).toContain(NOTES.id);
});
