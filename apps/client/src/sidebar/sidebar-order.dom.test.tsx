import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import { act } from 'react';
import { SIDEBAR_ORDER_STORAGE_KEY, SIDEBAR_SEPARATORS_STORAGE_KEY, useSidebarProjects } from '@/sidebar/sidebar-projects';
import { useSettings } from '@/state/settings';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { menuItem } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

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

const previousScope = useSettings.getState().sidebarScope;
const previousEverywhere = useSettings.getState().needsYouAllProjects;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* The project headings of the sidebar, top to bottom, by name. */
function headings(): string[] {
    return [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"]')].map((row) => row.getAttribute('aria-label')?.split(' · ')[0] ?? '');
}

function heading(name: string): HTMLElement | null {
    return (
        [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"]')].find((row) => row.getAttribute('aria-label')?.startsWith(name)) ?? null
    );
}

function openContextMenu(target: HTMLElement): Promise<void> {
    return act(async () => {
        target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
    });
}

/* The separators a person put between the projects, top to bottom, by what they read. */
function separators(): string[] {
    return [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="separator:"]')].map((row) => row.getAttribute('aria-label') ?? '');
}

/* The sidebar rows top to bottom: project headings by name, separators by label. */
function order(): string[] {
    return [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"], [data-sidebar-row^="separator:"]')].map(
        (row) => row.getAttribute('aria-label')?.split(' · ')[0] ?? ''
    );
}

beforeEach(async () => {
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
    localStorage.removeItem(SIDEBAR_SEPARATORS_STORAGE_KEY);
    useSidebarProjects.setState({ order: [], collapsed: [], separators: [], renamingSeparatorId: null, newViewFor: null });
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} } as never);
    machine.emit('project.summary', { summary: BOREALIS } as never);
    useSettings.setState({ sidebarScope: 'all-open' });
    page = mount();
    await page.renderApp();
    await until(() => headings().length === 2);
});

afterEach(async () => {
    await page.unmount();
    useSettings.setState({ sidebarScope: previousScope, needsYouAllProjects: previousEverywhere });
    workspace.close();
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
    localStorage.removeItem(SIDEBAR_SEPARATORS_STORAGE_KEY);
});

describe('the order of all open projects', () => {
    test('Move up puts a project above the one before it, and this client keeps that order', async () => {
        const [first, second] = headings();
        await openContextMenu(heading(second!)!);
        await until(() => menuItem('Move up') !== null);
        expect(menuItem('Move up')!.getAttribute('aria-disabled')).not.toBe('true');
        await clickOn(menuItem('Move up'));
        await until(() => headings()[0] === second);
        expect(headings()).toEqual([second, first]);
        const stored = JSON.parse(localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY) ?? '[]') as string[];
        expect(stored.map((key) => (JSON.parse(key) as string[])[1])).toEqual(
            [second, first].map((name) => (name === 'Borealis' ? 'project-borealis' : 'project-atlas'))
        );
    });

    test('showing only the current project leaves the order this client keeps alone', async () => {
        await until(() => useSidebarProjects.getState().order.length === 2);
        const kept = localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY);
        await act(async () => {
            useSettings.setState({ sidebarScope: 'current', needsYouAllProjects: false });
        });
        await until(() => headings().length < 2);
        expect(useSidebarProjects.getState().order).toHaveLength(2);
        expect(localStorage.getItem(SIDEBAR_ORDER_STORAGE_KEY)).toBe(kept);
    });

    test('a separator comes from the footer, takes a label, moves, hides what it heads and goes again', async () => {
        const [first, second] = headings();
        const footerButton = [...page.host.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent?.trim() === 'Separator');
        await clickOn(footerButton!);
        const labelField = (): HTMLInputElement | null => page.host.querySelector<HTMLInputElement>('input[placeholder="Label (optional)"]');
        await until(() => labelField() !== null);
        const field = labelField()!;
        await act(async () => {
            field.value = 'Clients';
            field.blur();
        });
        await until(() => separators().length === 1 && separators()[0] === 'Clients');
        expect(order()).toEqual([first, second, 'Clients']);
        expect(JSON.parse(localStorage.getItem(SIDEBAR_SEPARATORS_STORAGE_KEY) ?? '[]')).toEqual([expect.objectContaining({ label: 'Clients' })]);

        const separator = (): HTMLElement => page.host.querySelector<HTMLElement>('[data-sidebar-row^="separator:"]')!;
        await openContextMenu(separator());
        await until(() => menuItem('Move up') !== null);
        await clickOn(menuItem('Move up'));
        await until(() => order()[1] === 'Clients');
        expect(order()).toEqual([first, 'Clients', second]);

        expect(separator().getAttribute('aria-expanded')).toBe('true');
        await clickOn(separator());
        await until(() => heading(second!) === null);
        expect(order()).toEqual([first, 'Clients']);
        expect(separator().getAttribute('aria-expanded')).toBe('false');
        await clickOn(separator());
        await until(() => heading(second!) !== null);
        expect(order()).toEqual([first, 'Clients', second]);

        await openContextMenu(separator());
        await until(() => menuItem('Delete') !== null);
        await clickOn(menuItem('Delete'));
        await until(() => separators().length === 0);
        expect(useSidebarProjects.getState().order.some((key) => key.startsWith('separator:'))).toBe(false);
    });

    test('the project on screen has its New view row under its own list', async () => {
        const active = headings().find((name) => name !== 'Borealis')!;
        await until(() => page.host.querySelectorAll('[data-sidebar-row^="new-view:"]').length === 1);
        const rows = [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"], [data-sidebar-row^="new-view:"]')];
        const at = rows.indexOf(heading(active)!);
        expect(rows[at + 1]?.textContent).toBe('New view');
    });

    test('with only the current project, New view sits in the footer and not under the list', async () => {
        await act(async () => {
            useSettings.setState({ sidebarScope: 'current', needsYouAllProjects: false });
        });
        await until(() => headings().length === 0);
        expect(page.host.querySelectorAll('[data-sidebar-row^="new-view:"]')).toHaveLength(0);
        const footer = [...page.host.querySelectorAll<HTMLElement>('aside button')].filter((button) => button.textContent?.trim() === 'New view');
        expect(footer).toHaveLength(1);
    });
});
