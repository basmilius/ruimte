import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { projectSidebarViews, type ProjectSummary, type ProjectView } from '@ruimte/contracts';
import { SIDEBAR_ORDER_STORAGE_KEY, useSidebarProjects } from '@/shell/sidebar-projects';
import { useSettings } from '@/state/settings';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';
import { emptyCanvas } from '../../testing/project-fixtures';

const CHATS: ProjectSummary = {
    projectId: 'project-chats',
    name: 'Chats',
    color: '#000',
    folder: '/home/chats',
    lastOpenedAt: 0,
    closedAt: null,
    available: true,
    icon: { kind: 'initial', value: 'C' },
    nameSource: 'chosen',
    scratch: true
};
const LOOSE: ProjectView = { kind: 'chat', id: 'loose', name: 'Quick question', node: {} };
const MAIN = emptyCanvas();

const previous = { scope: useSettings.getState().sidebarScope, everywhere: useSettings.getState().needsYouAllProjects };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* The project headings of the sidebar, top to bottom, by name. */
function headings(): string[] {
    return [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"]')].map((row) => row.getAttribute('aria-label')?.split(' · ')[0] ?? '');
}

function waiting(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-sidebar-row$="needs:${LOOSE.id}"]`);
}

beforeEach(async () => {
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
    useSidebarProjects.setState({ order: [], collapsed: [], separators: [], renamingSeparatorId: null, newViewFor: null });
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    machine.answer('project.sidebar', () => ({ projects: [{ summary: CHATS, views: projectSidebarViews([LOOSE], []) }] }));
    machine.answer('chat.list', () => ({ chats: [{ chatId: LOOSE.id, status: 'needs-you' }] }) as never);
    machine.emit('project.summary', { summary: CHATS } as never);
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    useSettings.setState({ sidebarScope: previous.scope, needsYouAllProjects: previous.everywhere });
    workspace.close();
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
});

describe('Chats in the sidebar while another project is open', () => {
    test('leads the list of all open projects, with its waiting chat in "Needs you"', async () => {
        useSettings.setState({ sidebarScope: 'all-open' });
        await page.renderApp();
        await until(() => headings().length === 2 && waiting() !== null);
        expect(headings()[0]).toBe('Chats');
        expect(waiting()!.textContent).toContain('Quick question');
    });

    test('puts its waiting chat in "Needs you" of the current project, without a heading of its own', async () => {
        useSettings.setState({ sidebarScope: 'current', needsYouAllProjects: true });
        await page.renderApp();
        await until(() => waiting() !== null);
        expect(waiting()!.textContent).toContain('Quick question');
        expect(headings()).toEqual([]);
    });
});
