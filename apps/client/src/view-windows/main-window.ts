import { auxWindowKey, splitAuxWindowKey } from '@ruimte/desktop-bridge';
import { dropAuxLocals } from '@/clients/project/client-local';
import { runMenuCommand } from '@/commands/run';
import { desktop } from '@/desktop/bridge';
import { locateView } from '@/layout/split';
import { useDocument } from '@/state/document';
import { splitKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { browserStorage } from '@/state/stored-json';
import { provideViewHomes } from '@/state/view-homes';
import { fireAndForget } from '@/transport-api/transport';
import { postToWindow, projectKey, readWindowMessage, tellWindow } from './messages';
import { awayViewsOf, followAuxViews, pruneAuxViews } from './registry';
import { answerWindow, isGranted, isOfProject, resetWindows, ungrant } from './windows';

/* How long a closing project waits for its auxiliary windows to let go of it. */
const LEAVE_WAIT_MS = 3000;

/* More messages than this for a project in the back are dropped, so a window nobody returns to holds no growing list. */
const HELD_LIMIT = 16;

interface MainWindowState {
    /* The project on screen, by the key the shell knows it by. */
    project: string | null;

    /* The ids of its auxiliary windows that are open. */
    alive: string[];

    /* The auxiliary window that has each view this window may not show. */
    away: Map<string, string>;
}

const state: MainWindowState = { project: null, alive: [], away: new Map() };

export function awayWindowOf(viewId: string): string | null {
    return isGranted(viewId) ? null : (state.away.get(viewId) ?? null);
}

/* The list is right and this grid is not: a view an auxiliary window has leaves this one. */
function heal(): void {
    for (const viewId of state.away.keys()) {
        const { layout } = useDocument.getState();

        if (!isGranted(viewId) && layout !== null && locateView(layout, viewId) !== null) {
            useDocument.getState().closeViewTab(viewId);
        }
    }
}

function recompute(): void {
    state.away = state.project === null ? new Map() : awayViewsOf(state.project, state.alive);

    // A grant only bridges the moment before the list agrees that a view is this window's.
    const settled = useDocument
        .getState()
        .views.map((view) => view.id)
        .filter((viewId) => isGranted(viewId) && !state.away.has(viewId));

    ungrant(settled);
    heal();
}

/* Never while the app quits: an auxiliary window that closes then is not in `alive`, and still comes back at the next start. */
function prune(project: string, alive: readonly string[]): void {
    const { endpointId, id } = splitKey(project);
    dropAuxLocals(browserStorage(), endpointId, id, alive);
    pruneAuxViews(project, alive);
}

async function refresh(opened: boolean): Promise<void> {
    const project = state.project;

    if (project === null) {
        return;
    }

    const alive =
        (await desktop()
            ?.auxWindows?.(project)
            .catch(() => [])) ?? [];

    if (state.project !== project) {
        return;
    }

    state.alive = alive;

    if (opened) {
        prune(project, alive);
    }

    recompute();
}

function follow(): void {
    const project = projectKey();

    if (project === state.project) {
        return;
    }

    state.project = project;
    state.alive = [];
    state.away = new Map();
    resetWindows();
    void fireAndForget('refresh', refresh(true));
}

/*
 * A person closed an auxiliary window, which closes what stood in it. Nothing opens here, and its
 * views can be shown here again. A project that is not on screen loses the record the next time it opens.
 */
function forget(key: string): void {
    const aux = splitAuxWindowKey(key);

    if (aux === null || aux.project !== state.project) {
        return;
    }

    state.alive = state.alive.filter((other) => other !== aux.id);
    prune(aux.project, state.alive);
    recompute();
}

/* Messages for a project this window keeps as a tab in the back, until the window shows that project. */
const held: { from: string; text: string }[] = [];

function take(from: string, text: string): void {
    if (!isOfProject(from)) {
        if (held.length < HELD_LIMIT) {
            held.push({ from, text });
        }

        return;
    }

    const message = readWindowMessage(text);

    if (message === null || answerWindow(from, message)) {
        return;
    }

    if (message.type === 'run') {
        runMenuCommand(message.command);
    }
}

function takeHeld(): void {
    for (const { from, text } of held.splice(0)) {
        if (isOfProject(from)) {
            take(from, text);
        }
    }
}

/* The window that has the project tracks which views its auxiliary windows have, so its own grid leaves those alone. */
export function startMainWindow(): () => void {
    const shell = desktop();

    provideViewHomes({
        elsewhere: (viewId) => awayWindowOf(viewId) !== null,
        reach: (viewId) => {
            const aux = awayWindowOf(viewId);

            if (aux === null || state.project === null) {
                return;
            }

            const key = auxWindowKey(state.project, aux);
            shell?.openWindow?.(key);
            tellWindow(key, { type: 'show', viewId });
        }
    });

    follow();
    takeHeld();

    const stops = [
        useProject.subscribe(() => {
            follow();
            takeHeld();
        }),
        followAuxViews(recompute),
        shell?.onAuxWindows?.(() => void fireAndForget('refresh', refresh(false))),
        shell?.onAuxWindowClosed?.(forget),
        shell?.onWindowMessage?.(take)
    ];

    return () => {
        for (const stop of stops) {
            stop?.();
        }

        provideViewHomes(null);
        state.project = null;
        state.alive = [];
        state.away = new Map();
        resetWindows();
    };
}

/*
 * An auxiliary window is a client of the project too. The machine ends what a project runs only once
 * its last client let go, so this waits until the windows are gone before the project closes.
 */
export async function closeAuxWindowsOf(project: string): Promise<void> {
    const shell = desktop();
    const list = shell?.auxWindows;
    const watch = shell?.onAuxWindows;

    if (list === undefined || watch === undefined) {
        return;
    }

    const alive = await list(project).catch(() => []);

    if (alive.length === 0) {
        return;
    }

    await new Promise<void>((resolve) => {
        const done = (): void => {
            clearTimeout(timer);
            stop();
            resolve();
        };

        const timer = setTimeout(done, LEAVE_WAIT_MS);

        const stop = watch(() => {
            void fireAndForget(
                'auxWindows',
                list(project).then((left) => {
                    if (left.length === 0) {
                        done();
                    }
                })
            );
        });

        for (const aux of alive) {
            void fireAndForget('postToWindow', postToWindow(auxWindowKey(project, aux), { type: 'leave' }));
        }
    });

    const { endpointId, id } = splitKey(project);
    dropAuxLocals(browserStorage(), endpointId, id);
    pruneAuxViews(project, []);
}
