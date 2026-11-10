import { afterEach, beforeEach, expect, test } from 'bun:test';
import { projectSidebarViews, type ProjectSummary, type ProjectView } from '@ruimte/contracts';
import { act } from 'react';
import { useSettings } from '@/state/settings';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { useSidebarProjects } from '../project/sidebar-projects';

const background: ProjectSummary = {
    projectId: 'background',
    name: 'Background',
    color: 'blue',
    folder: '/work/background',
    lastOpenedAt: 1,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'B' },
    nameSource: 'chosen'
};
const views: ProjectView[] = [
    { kind: 'file', id: 'first-file', name: 'First file', path: 'first.txt' },
    { kind: 'file', id: 'second-file', name: 'Second file', path: 'second.txt' }
];
const previous = useSettings.getState().sidebarScope;
let workspace: FakeWorkspace;
let page: Mounted;

function row(id: string): HTMLElement {
    return [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row]')].find((entry) => entry.dataset.sidebarRow?.endsWith(id))!;
}

beforeEach(async () => {
    useSidebarProjects.setState({ order: [], collapsed: [], separators: [], renamingSeparatorId: null, newViewFor: null });
    const machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views }, { activeViewId: null, views: {} });
    machine.answer('project.sidebar', () => ({
        projects: [
            {
                summary: background,
                views: projectSidebarViews(
                    views.map((view) => ({ ...view, id: `background-${view.id}` })),
                    []
                )
            }
        ]
    }));
    machine.emit('project.summary', { summary: background });
    useSettings.setState({ sidebarScope: 'all-open' });
    page = mount();
    await page.renderApp();
    await until(() => row('view:background-first-file') !== undefined);
});

afterEach(async () => {
    await page?.unmount();
    workspace?.close();
    useSettings.setState({ sidebarScope: previous });
    useSidebarProjects.setState({ order: [], collapsed: [], separators: [], renamingSeparatorId: null, newViewFor: null });
});

test('focus and arrows share one tab stop across active and background project rows', async () => {
    const first = row('view:background-first-file');
    const second = row('view:background-second-file');
    await act(async () => first.focus());
    expect(first.tabIndex).toBe(0);
    await pressKey(first, 'ArrowDown');
    expect(document.activeElement).toBe(second);
    expect(first.tabIndex).toBe(-1);
    expect(second.tabIndex).toBe(0);
    await pressKey(second, 'ArrowUp');
    expect(document.activeElement).toBe(first);
    const active = row('view:first-file');
    await act(async () => active.focus());
    await pressKey(active, 'ArrowDown');
    expect(document.activeElement).toBe(row('view:second-file'));
    expect(page.host.querySelectorAll('[data-sidebar-row][tabindex="0"]')).toHaveLength(1);
});

test('a project heading keeps its fold keys and arrows skip its hidden rows', async () => {
    const heading = [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"]')].find((entry) =>
        entry.getAttribute('aria-label')?.startsWith('Background')
    )!;
    await act(async () => heading.focus());
    await pressKey(heading, 'ArrowLeft');
    expect(heading.getAttribute('aria-expanded')).toBe('false');
    expect(row('view:background-first-file')).toBeUndefined();
    const visible = [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row]')];
    await pressKey(heading, 'ArrowDown');
    expect(document.activeElement).toBe(visible[visible.indexOf(heading) + 1]);
    await act(async () => heading.focus());
    await pressKey(heading, 'ArrowRight');
    expect(heading.getAttribute('aria-expanded')).toBe('true');
    await pressKey(heading, 'ArrowDown');
    expect(document.activeElement).toBe(row('view:background-first-file'));
});

test('arrows in a rename field stay in the field', async () => {
    await act(async () => {
        useSidebarProjects.setState((state) => ({
            separators: [{ id: 'navigation', label: 'Heading', folded: false }],
            order: [...state.order, 'separator:navigation']
        }));
    });
    const separator = row('separator:navigation');
    await act(async () => separator.focus());
    await pressKey(separator, 'F2');
    const field = page.host.querySelector<HTMLInputElement>('input[placeholder="Label (optional)"]')!;
    await until(() => document.activeElement === field);
    await pressKey(field, 'ArrowDown');
    expect(document.activeElement).toBe(field);
    await pressKey(field, 'ArrowUp');
    expect(document.activeElement).toBe(field);
    await pressKey(field, 'Escape');
});
