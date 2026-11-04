import type { ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { mount, until, type Mounted } from './dom';
import type { FakeMachine } from './fake-machine';
import { openFakeWorkspace } from './fake-workspace';

export interface CanvasPage {
    page: Mounted;
    close(): Promise<void>;
}

/* The first of `views` open in the window; `ready` is a node id to wait for, or a check on the page. */
export async function openCanvasPage(machine: FakeMachine, views: ProjectCanvasView[], ready: string | ((host: HTMLElement) => boolean)): Promise<CanvasPage> {
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    const workspace = await openFakeWorkspace(machine, { views }, { activeViewId: views[0]!.id, views: {} });
    const page = mount();
    await page.renderApp();
    await until(() => (typeof ready === 'string' ? page.host.querySelector(`[data-node-id="${ready}"]`) !== null : ready(page.host)));
    return {
        page,
        async close() {
            await page.unmount();
            workspace.close();
        }
    };
}

/* The nodes of a canvas in the last save that went over the wire. */
export function savedNodes(machine: FakeMachine, viewId = 'main'): ProjectNode[] {
    const saved = machine
        .requests('project.save')
        .at(-1)
        ?.content.views.find((candidate) => candidate.id === viewId);
    return saved?.kind === 'canvas' ? (saved.nodes ?? []) : [];
}

export async function openContextMenu(target: Element, at = { x: 40, y: 40 }): Promise<void> {
    await act(async () => {
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: at.x, clientY: at.y, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

export function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menu"] [role^="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.includes(text)) ?? null;
}
