import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ProjectCanvasView, ProjectNode, ProjectSummary, ProjectView } from '@ruimte/contracts';
import { SIDEBAR_ORDER_STORAGE_KEY, SIDEBAR_SEPARATORS_STORAGE_KEY, useSidebarProjects } from '@/shell/sidebar-projects';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, pressKey, until, type Mounted } from '../../testing/dom';

const BOREALIS: ProjectSummary = {
    projectId: 'project-borealis',
    name: 'Borealis',
    color: '#000',
    folder: '/work/borealis',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'B' },
    nameSource: 'chosen'
};

const HEADING = {
    kind: 'subheader',
    id: 'agents',
    name: 'Agents'
} as unknown as ProjectView;
const PLAN: ProjectNode = {
    id: 'plan',
    kind: 'terminal',
    title: 'Shell here',
    x: 0,
    y: 0,
    w: 560,
    h: 360
};
const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: [PLAN],
    texts: [],
    edges: [],
    layouts: []
};

const previousScope = useSettings.getState().sidebarScope;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim().startsWith(text)) ?? null;
}

/* What a right-click does: the row takes the focus on the press, then the menu opens. */
async function rightClick(target: HTMLElement): Promise<void> {
    await act(async () => {
        target.focus();
        target.dispatchEvent(
            new MouseEvent('contextmenu', {
                bubbles: true,
                cancelable: true,
                clientX: 10,
                clientY: 10,
                button: 2
            })
        );
    });
}

/* A few turns and frames, so whatever the closing menu does with the focus has happened. */
async function settle(): Promise<void> {
    for (let turn = 0; turn < 10; turn++) {
        await act(async () => {
            await new Promise((resolve) => setTimeout(resolve, 20));
        });
    }
}

/*
 * A menu a person opened and closed before, from another row. Base UI keeps the element that had the
 * focus before any popup opened in one list for the page, and returns the focus there when a closing
 * menu finds its own trigger gone.
 */
async function anEarlierMenu(): Promise<void> {
    const project = page.host.querySelector<HTMLElement>('[data-sidebar-row^="project:"]')!;
    await rightClick(project);
    await until(() => document.querySelector('[role="menu"]') !== null);
    await settle();
    await pressKey(document.activeElement ?? document.body, 'Escape');
    await until(() => document.querySelector('[role="menu"]') === null);
    await settle();
}

function separator(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('[data-sidebar-row^="separator:"]');
}

function separatorField(): HTMLInputElement | null {
    return page.host.querySelector<HTMLInputElement>('input[placeholder="Label (optional)"]');
}

/* A separator between the projects, as a person left it in an earlier session. */
async function withSeparator(label: string): Promise<void> {
    const id = 'kept';
    await act(async () => {
        useSidebarProjects.setState((state) => ({
            separators: [{ id, label, folded: false }],
            order: [...state.order, `separator:${id}`]
        }));
    });
    await until(() => separator() !== null);
}

beforeEach(async () => {
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
    localStorage.removeItem(SIDEBAR_SEPARATORS_STORAGE_KEY);
    useSidebarProjects.setState({
        order: [],
        collapsed: [],
        separators: [],
        renamingSeparatorId: null,
        newViewFor: null
    });
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [HEADING, MAIN] }, { activeViewId: MAIN.id, views: {} });
    machine.emit('project.summary', { summary: BOREALIS } as never);
    useSettings.setState({ sidebarScope: 'all-open' });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelectorAll('[data-sidebar-row^="project:"]').length === 2);
    await until(() => useSidebarProjects.getState().order.length === 2);
});

afterEach(async () => {
    await page.unmount();
    useSettings.setState({ sidebarScope: previousScope });
    useUi.getState().setSidebarExpanded(null);
    workspace.close();
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
    localStorage.removeItem(SIDEBAR_SEPARATORS_STORAGE_KEY);
});

describe('renaming a separator between projects', () => {
    for (const [label, earlier] of [
        ['Clients', false],
        ['', false],
        ['Clients', true],
        ['', true]
    ] as const) {
        test(`Rename in the menu of a ${label ? 'heading' : 'bare line'}${earlier ? ', after an earlier menu,' : ''} opens its field and keeps it open`, async () => {
            await withSeparator(label);
            if (earlier) {
                await anEarlierMenu();
            }
            await rightClick(separator()!);
            await until(() => menuItem('Rename') !== null);
            await settle();
            const renaming: (string | null)[] = [];
            const stop = useSidebarProjects.subscribe((state) => {
                renaming.push(state.renamingSeparatorId);
            });
            await clickOn(menuItem('Rename'));
            await settle();
            stop();
            // Opened once and never closed again by a focus the menu gave back.
            expect([...new Set(renaming)]).toEqual(['kept']);
            expect(separatorField()).not.toBeNull();
            expect(document.activeElement).toBe(separatorField());
        });
    }

    test('Escape in the menu still gives the keyboard back to the separator', async () => {
        await withSeparator('Clients');
        await anEarlierMenu();
        await rightClick(separator()!);
        await until(() => menuItem('Rename') !== null);
        await settle();
        await pressKey(document.activeElement ?? document.body, 'Escape');
        await until(() => document.querySelector('[role="menu"]') === null);
        await settle();
        expect(document.activeElement).toBe(separator());
        expect(separatorField()).toBeNull();
    });

    test('F2 opens the field and keeps it open', async () => {
        await withSeparator('Clients');
        await act(async () => separator()!.focus());
        await pressKey(separator()!, 'F2');
        await settle();
        expect(separatorField()).not.toBeNull();
        expect(document.activeElement).toBe(separatorField());
    });

    test('a double click on a bare line opens the field and keeps it open', async () => {
        await withSeparator('');
        await act(async () => {
            separator()!.focus();
            separator()!.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
        });
        await settle();
        expect(separatorField()).not.toBeNull();
        expect(document.activeElement).toBe(separatorField());
    });
});

describe('renaming other sidebar rows from their menu', () => {
    test('Rename in the menu of a heading, after an earlier menu, opens its field and keeps it open', async () => {
        const heading = (): HTMLElement | null => page.host.querySelector<HTMLElement>(`[data-sidebar-row$=":view:${HEADING.id}"]`);
        await until(() => heading() !== null);
        await anEarlierMenu();
        await rightClick(heading()!);
        await until(() => menuItem('Rename') !== null);
        await settle();
        await clickOn(menuItem('Rename'));
        await settle();
        const field = page.host.querySelector<HTMLInputElement>('aside input');
        expect(field).not.toBeNull();
        expect(document.activeElement).toBe(field);
    });

    test('Rename in the menu of a node row, after an earlier menu, opens its field and keeps it open', async () => {
        const row = (): HTMLElement | null => page.host.querySelector<HTMLElement>(`[data-sidebar-row$=":node:${MAIN.id}:${PLAN.id}"]`);
        // Set outright, since what another test left open would otherwise decide whether the canvas shows its nodes.
        await act(async () => useUi.getState().setSidebarExpanded([MAIN.id]));
        await until(() => row() !== null);
        await anEarlierMenu();
        await rightClick(row()!);
        await until(() => menuItem('Rename') !== null);
        await settle();
        await clickOn(menuItem('Rename'));
        await settle();
        const field = page.host.querySelector<HTMLInputElement>('aside input');
        expect(field).not.toBeNull();
        expect(document.activeElement).toBe(field);
    });
});
