import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ProjectSummary } from '@ruimte/contracts';
import { SIDEBAR_ORDER_STORAGE_KEY, useSidebarProjects } from '@/shell/sidebar-projects';
import { useSettings } from '@/state/settings';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

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

const previousScope = useSettings.getState().sidebarScope;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* The project headings of the sidebar, top to bottom, by name. */
function headings(): string[] {
    return [...page.host.querySelectorAll<HTMLElement>('[data-sidebar-row^="project:"]')].map((row) => row.getAttribute('aria-label')?.split(' · ')[0] ?? '');
}

beforeEach(async () => {
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
    useSidebarProjects.setState({ order: [], collapsed: [], separators: [], renamingSeparatorId: null, newViewFor: null });
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} } as never);
    machine.emit('project.summary', { summary: CHATS } as never);
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    useSettings.setState({ sidebarScope: previousScope });
    workspace.close();
    localStorage.removeItem(SIDEBAR_ORDER_STORAGE_KEY);
});

describe('Chats in the sidebar while another project is open', () => {
    test('leads the list of all open projects', async () => {
        useSettings.setState({ sidebarScope: 'all-open' });
        await page.renderApp();
        await until(() => headings().length === 2);
        expect(headings()[0]).toBe('Chats');
    });
});
