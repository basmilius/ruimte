import { auxWindowKey, splitAuxWindowKey } from '@ruimte/desktop-bridge';
import i18next from 'i18next';
import { desktop, type WindowPoint } from '@/desktop/bridge';
import { locateView, viewIdsIn } from '@/layout/split';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { useToasts } from '@/state/toasts';
import { auxWindowId } from '@/state/window-target';
import { looseTabLabel } from '@/surface/panels/tab-label';
import { fireAndForget } from '@/transport-api/transport';
import { windowWorkspace } from '@/workspace/window';
import { idOf, itemsOf, letGo, placeItems, type TakenItems } from './items';
import { canMoveViews, ownWindowKey, postToWindow, projectKey, tellWindow, type WindowItem, type WindowMessage, type WindowPlace } from './messages';

/* The views for a window this one just opened, by that window's key, until it asks for them. */
const pending = new Map<string, WindowItem[]>();

/*
 * The views this window was just handed. It may place them although the list of who has what
 * (`registry.ts`) still names the window they came from.
 */
const granted = new Set<string>();

export function isGranted(viewId: string): boolean {
    return granted.has(viewId);
}

export function grant(ids: readonly string[]): void {
    for (const id of ids) {
        granted.add(id);
    }
}

export function ungrant(ids: Iterable<string>): void {
    for (const id of ids) {
        granted.delete(id);
    }
}

export function resetWindows(): void {
    pending.clear();
    granted.clear();
}

/* The other window reads this window's record next, so it is written now and not on the save clock. */
function keepLocal(): void {
    windowWorkspace()?.connection.projects.keepLocal();
}

function sayHeld({ held }: TakenItems): void {
    const [first] = held;

    if (first !== undefined) {
        useToasts.getState().show({ kind: 'error', title: i18next.t('shell:viewWindows.held', { name: looseTabLabel(first) }) });
    }
}

/* The other window only knows a view that is in the project's file, and one made a moment ago may not be yet. */
async function flushProject(): Promise<void> {
    await fireAndForget('projects.flush', windowWorkspace()?.connection.projects.flush());
}

/* The new window asks for the views once it is up (`ready`). `at` is where its corner goes on the screen. */
export async function moveToNewWindow(ids: readonly string[], at?: WindowPoint): Promise<boolean> {
    const project = projectKey();

    if (project === null || !canMoveViews()) {
        return false;
    }

    const taken = itemsOf(ids);
    sayHeld(taken);

    if (taken.items.length === 0) {
        return false;
    }

    await flushProject();

    const key = auxWindowKey(project, crypto.randomUUID());
    pending.set(key, taken.items);
    letGo(taken.items.map(idOf));
    keepLocal();
    desktop()?.openWindow?.(key, undefined, at);

    return true;
}

export async function moveToMainWindow(ids: readonly string[]): Promise<boolean> {
    const project = projectKey();

    if (project === null || auxWindowId() === null || !canMoveViews()) {
        return false;
    }

    const taken = itemsOf(ids);
    sayHeld(taken);

    if (taken.items.length === 0) {
        return false;
    }

    await flushProject();
    // Raised first, since a window that keeps the project as a tab in the back takes the views only once it shows the project.
    desktop()?.openWindow?.(project);

    if (!(await postToWindow(project, { type: 'give', items: taken.items, place: null }))) {
        return false;
    }

    letGo(taken.items.map(idOf));
    keepLocal();

    return true;
}

/* Whether the views are all this window shows. An auxiliary window that gives those away is no window any more. */
export function isWholeWindow(ids: readonly string[]): boolean {
    const { layout } = useDocument.getState();

    return layout !== null && viewIdsIn(layout).every((id) => ids.includes(id));
}

/* A drop in this window took the views out of another one, which hears it and lets go of them. */
export function takeFromWindow(from: string, items: readonly WindowItem[], place: WindowPlace | null): void {
    const ids = items.map(idOf);
    grant(ids);
    placeItems(items, place);
    keepLocal();
    tellWindow(from, { type: 'took', ids });
}

function gaveAway(ids: readonly string[]): void {
    const { views } = useDocument.getState();

    for (const id of ids) {
        if (views.some((view) => view.id === id)) {
            useDocument.getState().closeViewTab(id);
        } else {
            // Through its own close, which saves unsaved text first. The other window read the file before that.
            void fireAndForget('closeGuarded', useFiles.getState().closeGuarded(id));
        }
    }

    keepLocal();
}

function showHere(viewId: string): void {
    const { layout } = useDocument.getState();

    if (layout !== null && locateView(layout, viewId) !== null) {
        useDocument.getState().activateTab(viewId);
    }
}

/* The messages every window answers the same way. False for one that only the window that has the project or only an auxiliary window answers. */
export function answerWindow(from: string, message: WindowMessage): boolean {
    switch (message.type) {
        case 'ready': {
            const items = pending.get(from);
            pending.delete(from);
            tellWindow(from, items === undefined ? { type: 'none' } : { type: 'give', items, place: null });

            return true;
        }

        case 'give':
            grant(message.items.map(idOf));
            placeItems(message.items, message.place);
            keepLocal();

            return true;

        case 'took':
            gaveAway(message.ids);

            return true;

        case 'show':
            showHere(message.viewId);

            return true;

        default:
            return false;
    }
}

/* Whether `from` is another window of the project on screen. */
export function isOfProject(from: string, project: string | null = projectKey()): boolean {
    return project !== null && from !== ownWindowKey() && (from === project || splitAuxWindowKey(from)?.project === project);
}
