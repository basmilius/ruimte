import { desktop, isApplePlatform, type DesktopBridge, type WindowPoint } from '@/desktop/bridge';
import { confirmLeavingConflict } from '@/project/leave-conflict';
import { detachWindowTab, dropWindowTab, restoreWindowTabs, tabAfterClosing, useWindowTabs } from '@/project/window-tabs';
import { endpointKey, splitKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { leaveWorkspace, showStart } from '@/transport/connections';
import { windowWorkspace } from '@/transport/window';

/* Whether this app opens windows of its own. The desktop shell does; a browser tab has its own ways. */
export function canOpenWindows(shell: Pick<DesktopBridge, 'openWindow'> | null = desktop()): boolean {
    return typeof shell?.openWindow === 'function';
}

export function canMoveToNewWindow(shell: Pick<DesktopBridge, 'moveToNewWindow'> | null = desktop()): boolean {
    return typeof shell?.moveToNewWindow === 'function';
}

/* A window on the start screen. */
export function openNewWindow(): void {
    desktop()?.openWindow?.(null);
}

/* A project in a window of its own, or the window that already has it, brought to the front. */
export function openInNewWindow(endpointId: string, projectId: string, at?: WindowPoint): void {
    desktop()?.openWindow?.(endpointKey(endpointId, projectId), undefined, at);
}

/* Cmd-click on macOS, Ctrl-click elsewhere: a project opens in a window of its own, the way a link opens in a new tab. */
export function wantsNewWindow(
    event: { metaKey: boolean; ctrlKey: boolean },
    apple = isApplePlatform(),
    shell: Pick<DesktopBridge, 'openWindow'> | null = desktop()
): boolean {
    return canOpenWindows(shell) && (apple ? event.metaKey : event.ctrlKey);
}

/* The pieces a test stands in for; the app passes none of them. */
export interface MoveDeps {
    shell: Pick<DesktopBridge, 'moveToNewWindow'> | null;
    hasProject(): boolean;
    confirm(): Promise<boolean>;
    flush(): Promise<void>;
    leave(): Promise<void>;
    toStart(): void;
    /* The project on screen, as its tab key. */
    shownKey(): string | null;
    /* Shows another tab of the window, which leaves the project on screen on its way. */
    showTab(key: string): Promise<void>;
}

async function flushWorkspace(): Promise<void> {
    const workspace = windowWorkspace();
    if (!workspace) {
        return;
    }
    const { drawings, diagrams, projects } = workspace.connection;
    await Promise.all([drawings.flush(), diagrams.flush()]);
    await projects.flush();
}

// Reached through a call each: the connections reach this module through the actions, so their exports are not in yet when it loads.
const REAL_MOVE: MoveDeps = {
    shell: null,
    hasProject: () => windowWorkspace() !== null,
    confirm: () => confirmLeavingConflict(),
    flush: () => flushWorkspace(),
    leave: () => leaveWorkspace(),
    toStart: () => showStart(),
    shownKey: () => {
        const { current, currentEndpointId } = useProject.getState();
        return current !== null && currentEndpointId !== null ? endpointKey(currentEndpointId, current.projectId) : null;
    },
    showTab: async (key) => {
        const { endpointId, id } = splitKey(key);
        await (await import('@/project/open')).openProject(endpointId, id);
    }
};

/*
 * The project on screen, into a window of its own, whose corner goes to `at` when given. What is on
 * screen reaches its files first, so the new window reads what this one showed; the shell hands the
 * project over in one step, and only then does this window let go of it: for the tab beside it when
 * the window has tabs, or else for the start screen.
 */
export async function moveToNewWindow({ at, ...overrides }: Partial<MoveDeps> & { at?: WindowPoint } = {}): Promise<boolean> {
    const deps: MoveDeps = { ...REAL_MOVE, shell: desktop(), ...overrides };
    const move = deps.shell?.moveToNewWindow;
    if (!move || !deps.hasProject() || !(await deps.confirm())) {
        return false;
    }
    // A conflict the person chose to leave behind cannot be written, and the new window reads the file as it is.
    await deps.flush().catch(() => undefined);
    const key = deps.shownKey();
    const next = key === null ? null : tabAfterClosing(key);
    if (!(await (at === undefined ? move() : move(at)))) {
        return false;
    }
    if (key !== null) {
        dropWindowTab(key);
    }
    if (next !== null) {
        await deps.showTab(next).catch(() => undefined);
        return true;
    }
    await deps.leave().catch(() => undefined);
    deps.toStart();
    return true;
}

/*
 * A tab dragged out of the window, into a window of its own at `at`, for a shell that cannot follow
 * the pointer. The tab on screen moves with what it shows; another tab opens there and leaves this
 * window, or raises the window that has it.
 */
export async function tearOffTab(key: string, at: WindowPoint): Promise<void> {
    if (REAL_MOVE.shownKey() === key) {
        await moveToNewWindow({ at });
        return;
    }
    // Let go of first: the shell raises a window that still keeps the project instead of opening one.
    dropWindowTab(key);
    const { endpointId, id } = splitKey(key);
    openInNewWindow(endpointId, id, at);
}

/* Whether the shell can tear a tab off into a window that follows the pointer. */
export function canDragTabs(shell: Pick<DesktopBridge, 'tabDrag'> | null = desktop()): boolean {
    return typeof shell?.tabDrag === 'function';
}

/* The start of the drag under way, which its end waits for: a quick release can come before the start is through. */
let dragStarting: Promise<unknown> = Promise.resolve();

/*
 * A pressed tab left the window: the shell opens it in a window of its own that follows the pointer.
 * What is on screen reaches its files first, so that window reads what this one showed, and this
 * window goes on to the tab beside it, or to the start screen. Another tab leaves the window as it is.
 */
export function tearOutTab(key: string, grab: WindowPoint, tabWidth: number, overrides: Partial<TearOutDeps> = {}): Promise<boolean> {
    const started = startTearOut(key, grab, tabWidth, { ...REAL_MOVE, shell: desktop(), ...overrides });
    dragStarting = started.catch(() => undefined);
    return started;
}

/* The pieces a test stands in for, with the shell that follows the pointer. */
export type TearOutDeps = Omit<MoveDeps, 'shell'> & { shell: Pick<DesktopBridge, 'tabDrag'> | null };

async function startTearOut(key: string, grab: WindowPoint, tabWidth: number, deps: TearOutDeps): Promise<boolean> {
    const drag = deps.shell?.tabDrag;
    if (!drag) {
        return false;
    }
    const shown = deps.shownKey() === key;
    const next = shown ? tabAfterClosing(key) : null;
    // The tab leaves the strip at once, before anything waits, and comes back only if the shell says no.
    const before = useWindowTabs.getState().tabs;
    detachWindowTab(key);
    if (shown) {
        await deps.flush().catch(() => undefined);
    }
    if (!(await drag('start', key, grab, false, tabWidth).catch(() => false))) {
        restoreWindowTabs(before);
        return false;
    }
    if (next !== null) {
        await deps.showTab(next).catch(() => undefined);
    } else if (shown) {
        await deps.leave().catch(() => undefined);
        deps.toStart();
    }
    return true;
}

/* The only tab of the window was pressed and moved: the window itself follows the pointer. */
export function startWindowDrag(key: string, grab: WindowPoint): Promise<boolean> {
    const started = desktop()?.tabDrag?.('start', key, grab, true) ?? Promise.resolve(false);
    dragStarting = started.catch(() => undefined);
    return started;
}

/* The press let go. Over another window the project goes there, so what is on screen reaches its files first. */
export async function endTabDrag(key: string, whole: boolean): Promise<void> {
    await dragStarting;
    if (whole) {
        await flushWorkspace().catch(() => undefined);
    }
    await desktop()
        ?.tabDrag?.('end', key, { x: 0, y: 0 }, whole)
        .catch(() => undefined);
}
