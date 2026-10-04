import { desktop, isApplePlatform, type DesktopBridge } from '@/desktop/bridge';
import { confirmLeavingConflict } from '@/project/leave-conflict';
import { endpointKey } from '@/state/keys';
import { windowWorkspace } from '@/state/window';
import { leaveWorkspace, showStart } from '@/transport/connections';

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
export function openInNewWindow(endpointId: string, projectId: string): void {
    desktop()?.openWindow?.(endpointKey(endpointId, projectId));
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
    toStart: () => showStart()
};

/*
 * The project on screen, into a window of its own. What is on screen reaches its files first, so the
 * new window reads what this one showed; the shell hands the project over in one step, and only then
 * does this window let go of it and go to the start screen.
 */
export async function moveToNewWindow(overrides: Partial<MoveDeps> = {}): Promise<boolean> {
    const deps: MoveDeps = { ...REAL_MOVE, shell: desktop(), ...overrides };
    const move = deps.shell?.moveToNewWindow;
    if (!move || !deps.hasProject() || !(await deps.confirm())) {
        return false;
    }
    // A conflict the person chose to leave behind cannot be written, and the new window reads the file as it is.
    await deps.flush().catch(() => undefined);
    if (!(await move())) {
        return false;
    }
    await deps.leave().catch(() => undefined);
    deps.toStart();
    return true;
}
