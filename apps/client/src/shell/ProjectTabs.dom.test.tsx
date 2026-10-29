import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { projectSidebarViews, type ProjectSummary } from '@ruimte/contracts';
import type { DesktopBridge } from '@/desktop/bridge';
import { startWindowTabs, useWindowTabs } from '@/project/window-tabs';
import { useSettings } from '@/state/settings';
import { useSnoozes } from '@/state/snooze';
import { chatInfoOf } from '../../testing/chat-info';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { menuItem, removeDesktop } from '../../testing/dom-helpers';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const SHOWN = 'fake-machine:project-atlas';
const BEHIND = 'fake-machine:project-borealis';
const CURRENT_CHAT = { kind: 'chat' as const, id: 'atlas-chat', name: 'Notes', node: {} };

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

/* The shell as it stands: a window detaches only a project it shows or keeps, and hears the page in the order it sent. */
interface FakeShell {
    bridge: DesktopBridge;
    heard: string[];
}

function fakeShell(): FakeShell {
    const heard: string[] = [];
    let kept: string[] = [];
    const bridge: DesktopBridge = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined,
        openWindow: (key) => void heard.push(`open ${key}`),
        holdTabs: async (keys) => {
            kept = [...keys];
            return keys;
        },
        tabDrag: async (phase, key) => {
            if (phase === 'end') {
                heard.push(`end ${key}`);
                return true;
            }
            const has = key === SHOWN || kept.includes(key);
            kept = kept.filter((one) => one !== key);
            heard.push(`${phase} ${key} ${has ? 'detached' : 'refused'}`);
            return has;
        }
    };
    return { bridge, heard };
}

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };
const previousNavigation = useSettings.getState().projectNavigation;
const previousScope = useSettings.getState().sidebarScope;
const previousEverywhere = useSettings.getState().needsYouAllProjects;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let shell: FakeShell;
let stopTabs: () => void;
let page: Mounted;

function tab(key: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`[data-tab-key="${key}"]`);
}

function pointer(type: string, x: number, y: number): PointerEvent {
    return new PointerEvent(type, { pointerId: 1, button: 0, clientX: x, clientY: y, bubbles: true, cancelable: true });
}

/* A press on a tab carried down and out of the strip, the way a person tears a tab off. */
async function dragOut(element: HTMLElement): Promise<void> {
    const at = (type: string, y: number) => pointer(type, 10, y);
    await act(async () => {
        element.dispatchEvent(at('pointerdown', 0));
    });
    await act(async () => {
        element.dispatchEvent(at('pointermove', 10));
    });
    await act(async () => {
        element.dispatchEvent(at('pointermove', 200));
    });
    await act(async () => {
        window.dispatchEvent(at('pointerup', 200));
    });
}

beforeEach(async () => {
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [CURRENT_CHAT] } as never, { activeViewId: null, views: {} } as never);
    machine.answer('project.sidebar', () => ({
        projects: [{ summary: BOREALIS, views: projectSidebarViews([{ kind: 'chat', id: 'borealis-chat', name: 'Review', node: {} }], []) }]
    }));
    machine.emit('project.summary', { summary: BOREALIS } as never);
    shell = fakeShell();
    scope.window.ruimteDesktop = shell.bridge;
    history.replaceState(null, '', `?state=${encodeURIComponent(JSON.stringify([BEHIND, SHOWN]))}`);
    useSettings.setState({ projectNavigation: 'tabs', sidebarScope: 'current', needsYouAllProjects: false });
    stopTabs = startWindowTabs();
    page = mount();
    await page.renderApp();
    await until(() => tab(SHOWN) !== null && tab(BEHIND) !== null);
});

afterEach(async () => {
    await page.unmount();
    stopTabs();
    useSettings.setState({ projectNavigation: previousNavigation });
    useSettings.setState({ sidebarScope: previousScope, needsYouAllProjects: previousEverywhere });
    history.replaceState(null, '', location.pathname);
    removeDesktop();
    workspace.close();
});

describe('tearing a project tab out of its window', () => {
    test('a tab in the back goes into a window of its own, and the window keeps showing its project', async () => {
        expect(tab(SHOWN)!.getAttribute('aria-selected')).toBe('true');
        await dragOut(tab(BEHIND)!);
        await until(() => shell.heard.includes(`end ${BEHIND}`));
        expect(shell.heard).toEqual([`start ${BEHIND} detached`, `end ${BEHIND}`]);
        expect(tab(BEHIND)).toBeNull();
        expect(tab(SHOWN)!.getAttribute('aria-selected')).toBe('true');
        expect(page.host.textContent).toContain('Atlas');
        expect(machine.requests('project.open')).toHaveLength(1);
    });
});

test('a background project counts waits from status events and removes a snoozed or answered wait without opening the project', async () => {
    const badge = (): Element | null => tab(BEHIND)?.querySelector('[aria-label="1 waiting"]') ?? null;

    await until(() => machine.requests('project.sidebar').length > 0);
    await act(async () => machine.emit('chat.status', { chatId: 'borealis-chat', info: chatInfoOf('borealis-chat', { status: 'needs-you' }) }));
    await until(() => badge() !== null);
    expect(badge()!.textContent).toBe('1');

    await act(async () => useSnoozes.getState().receive('fake-machine', [{ nodeId: 'borealis-chat', until: 4_000_000_000_000 }]));
    await until(() => badge() === null);
    await act(async () => useSnoozes.getState().receive('fake-machine', []));
    await until(() => badge() !== null);
    await act(async () => machine.emit('chat.status', { chatId: 'borealis-chat', info: chatInfoOf('borealis-chat', { status: 'running' }) }));
    await until(() => badge() === null);
    expect(machine.requests('project.open')).toHaveLength(1);

    await act(async () => machine.emit('chat.status', { chatId: 'borealis-chat', info: chatInfoOf('borealis-chat', { status: 'needs-you' }) }));
    await until(() => badge() !== null);
    await act(async () => machine.drop());
    await until(() => badge() === null);
});

test('the project tabs and the all-project sidebar share one read of their machine', async () => {
    await until(() => machine.requests('project.sidebar').length > 0);
    const reads = machine.requests('project.sidebar').length;

    await act(async () => useSettings.setState({ sidebarScope: 'all-open' }));
    await until(() => page.host.querySelector('[data-sidebar-row^="project:"]') !== null);
    expect(machine.requests('project.sidebar')).toHaveLength(reads);
});

test('a window that shows only the current project starts no background project reads', async () => {
    await act(async () => useWindowTabs.setState({ tabs: { keys: [SHOWN], active: SHOWN } }));
    await until(() => tab(BEHIND) === null);
    await page.unmount();
    const reads = machine.requests('project.sidebar').length;
    page = mount();

    await page.renderApp();
    await until(() => tab(SHOWN) !== null);
    expect(machine.requests('project.sidebar')).toHaveLength(reads);
});

test('the background project tab and sidebar heading count a later design chat together', async () => {
    await act(async () => machine.emit('chat.status', { chatId: 'borealis-chat', info: chatInfoOf('borealis-chat', { status: 'needs-you' }) }));
    await until(() => (tab(BEHIND)?.querySelector('[aria-label="1 waiting"]') ?? null) !== null);
    const views = projectSidebarViews(
        [
            {
                kind: 'design',
                id: 'onboarding',
                name: 'Onboarding',
                path: 'onboarding',
                node: {},
                chats: [{ id: 'design-review', name: 'Review', node: {} }]
            }
        ],
        []
    );

    await act(async () => {
        machine.emit('project.summary', { summary: BOREALIS, views });
        machine.emit('chat.status', { chatId: 'design-review', info: chatInfoOf('design-review', { status: 'needs-you' }) });
        useSettings.setState({ sidebarScope: 'all-open' });
    });
    const heading = (): Element | null => page.host.querySelector('[data-sidebar-row=\'project:["fake-machine","project-borealis"]\']');
    await until(() => heading()?.querySelector('[aria-label="1 waiting"]') !== undefined && heading()?.querySelector('[aria-label="1 waiting"]') !== null);
    expect(tab(BEHIND)!.querySelector('[aria-label="1 waiting"]')!.textContent).toBe('1');
    expect(heading()!.querySelector('[aria-label="1 waiting"]')!.textContent).toBe('1');
});

test('the current project counts its live sessions without needing a background snapshot', async () => {
    const badge = (): Element | null => tab(SHOWN)?.querySelector('[aria-label="1 waiting"]') ?? null;

    await act(async () => machine.emit('chat.status', { chatId: CURRENT_CHAT.id, info: chatInfoOf(CURRENT_CHAT.id, { status: 'needs-you' }) }));
    await until(() => badge() !== null);
    await act(async () => machine.emit('chat.status', { chatId: CURRENT_CHAT.id, info: chatInfoOf(CURRENT_CHAT.id, { status: 'idle' }) }));
    await until(() => badge() === null);
});

function tabOrder(): string[] {
    return [...page.host.querySelectorAll<HTMLElement>('[data-tab-key]')].map((element) => element.dataset.tabKey ?? '');
}

async function openTabMenu(key: string): Promise<void> {
    await act(async () => {
        tab(key)!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

describe('pinning a project tab', () => {
    test('a pinned tab moves to the front, keeps its name, loses its close button, and is kept in the address of the window', async () => {
        expect(tabOrder()).toEqual([BEHIND, SHOWN]);
        await openTabMenu(SHOWN);
        await clickOn(menuItem('Pin tab'));
        await until(() => tab(SHOWN)?.hasAttribute('data-pinned') === true);
        expect(tabOrder()).toEqual([SHOWN, BEHIND]);
        expect(tab(SHOWN)!.querySelector('button')).toBeNull();
        expect(tab(SHOWN)!.textContent).toContain('Atlas');
        expect(new URLSearchParams(location.search).get('state')).toBe(JSON.stringify({ tabs: [SHOWN, BEHIND], pinned: [SHOWN] }));
    });

    test('Unpin tab gives a tab its close button back', async () => {
        await openTabMenu(SHOWN);
        await clickOn(menuItem('Pin tab'));
        await until(() => tab(SHOWN)?.hasAttribute('data-pinned') === true);
        await openTabMenu(SHOWN);
        await clickOn(menuItem('Unpin tab'));
        await until(() => tab(SHOWN)?.hasAttribute('data-pinned') === false);
        expect(tab(SHOWN)!.querySelector('button')).not.toBeNull();
    });
});

/* Lays the tabs out side by side, 100px wide with 4px between them, since happy-dom measures every box as empty. */
function layOut(): void {
    tabOrder().forEach((key, i) => {
        const left = i * 104;
        tab(key)!.getBoundingClientRect = () => ({ left, right: left + 100, top: 0, bottom: 30, width: 100, height: 30, x: left, y: 0 }) as DOMRect;
    });
}

function insertion(): HTMLElement | null {
    return page.host.querySelector<HTMLElement>('[data-tab-insertion]');
}

/* A press and its release on a tab; true when the press was kept from starting a text selection. */
async function pressTab(element: HTMLElement, init: MouseEventInit): Promise<boolean> {
    const down = new MouseEvent('mousedown', { ...init, bubbles: true, cancelable: true });
    await act(async () => {
        element.dispatchEvent(down);
        element.dispatchEvent(new MouseEvent(init.button === 1 ? 'auxclick' : 'click', { ...init, bubbles: true, cancelable: true }));
    });
    return down.defaultPrevented;
}

function closeQuestion(name: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) => dialog.textContent?.includes(`Close ${name}?`)) ?? null;
}

const CLOSING_PRESSES: Array<[string, MouseEventInit]> = [
    ['a shift-click', { button: 0, shiftKey: true }],
    ['a middle click', { button: 1 }]
];

describe('closing a project tab without its close button', () => {
    test.each(CLOSING_PRESSES)('%s on a tab in the back asks to close it and leaves the shown project selected', async (_name, init) => {
        expect(await pressTab(tab(BEHIND)!, init)).toBe(true);
        await until(() => closeQuestion('Borealis') !== null);
        expect(machine.requests('project.closing')).toEqual([{ projectId: 'project-borealis' }]);
        expect(tab(SHOWN)!.getAttribute('aria-selected')).toBe('true');
        expect(machine.requests('project.open')).toHaveLength(1);
    });

    test.each(CLOSING_PRESSES)('%s leaves a pinned tab open', async (_name, init) => {
        await openTabMenu(BEHIND);
        await clickOn(menuItem('Pin tab'));
        await until(() => tab(BEHIND)?.hasAttribute('data-pinned') === true);
        await pressTab(tab(BEHIND)!, init);
        expect(machine.requests('project.closing')).toEqual([]);
        expect(closeQuestion('Borealis')).toBeNull();
    });
});

describe('reordering project tabs', () => {
    test('a dragged tab shows where it lands and moves only when it is let go', async () => {
        layOut();
        const element = tab(BEHIND)!;
        const at = (type: string, x: number) => pointer(type, x, 10);
        await act(async () => {
            element.dispatchEvent(at('pointerdown', 50));
        });
        await act(async () => {
            element.dispatchEvent(at('pointermove', 60));
        });
        expect(insertion()).toBeNull();
        await act(async () => {
            element.dispatchEvent(at('pointermove', 180));
        });
        expect(insertion()!.style.left).toBe('205px');
        expect(tabOrder()).toEqual([BEHIND, SHOWN]);
        await act(async () => {
            element.dispatchEvent(at('pointerup', 180));
        });
        expect(insertion()).toBeNull();
        expect(tabOrder()).toEqual([SHOWN, BEHIND]);
        expect(new URLSearchParams(location.search).get('state')).toBe(JSON.stringify([SHOWN, BEHIND]));
    });

    test('a cancelled drag leaves the order as it was', async () => {
        layOut();
        const element = tab(BEHIND)!;
        const at = (type: string, x: number) => pointer(type, x, 10);
        await act(async () => {
            element.dispatchEvent(at('pointerdown', 50));
        });
        await act(async () => {
            element.dispatchEvent(at('pointermove', 180));
        });
        expect(insertion()).not.toBeNull();
        await act(async () => {
            element.dispatchEvent(at('pointercancel', 180));
        });
        expect(insertion()).toBeNull();
        expect(tabOrder()).toEqual([BEHIND, SHOWN]);
    });

    test('the tab menu moves a tab one place, and offers no move past the end', async () => {
        await openTabMenu(BEHIND);
        expect(menuItem('Move tab left')!.hasAttribute('data-disabled')).toBe(true);
        await clickOn(menuItem('Move tab right'));
        await until(() => tabOrder()[0] === SHOWN);
        expect(tabOrder()).toEqual([SHOWN, BEHIND]);
    });
});
