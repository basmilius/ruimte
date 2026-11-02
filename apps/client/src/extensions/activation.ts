import { extensionKeyOf } from '@/extensions/registry';
import { shownViewIdsIn } from '@/shell/split';
import { defaultCanvases, focusedCanvas, liveCanvas, type CanvasState } from '@/state/canvas';
import { useDocument, type DocumentState } from '@/state/document';
import { useFiles } from '@/state/files';

type Shown = Pick<DocumentState, 'views' | 'activeViewId' | 'layout'>;

// Every cell of the grid is on screen, not only the one with the focus.
function shownViews({ views, activeViewId, layout }: Shown): Shown['views'] {
    const shownIds = new Set([...(layout === null ? [] : shownViewIdsIn(layout)), ...(activeViewId === null ? [] : [activeViewId])]);

    return views.filter((view) => shownIds.has(view.id));
}

// A view of an extension is kept as `unknown`, with what the extension stored under `raw`.
function viewKeyOf(view: Shown['views'][number]): string | null {
    return view.kind === 'unknown' ? extensionKeyOf(view.raw) : null;
}

/*
 * Whether this manifest wants loading now. Without `activation`, or with `start`, always. A node or view counts only
 * when it is this extension's: another one may name a type the same.
 */
export function wantsLoading(extensionId: string, activation: readonly string[] | undefined): boolean {
    if (activation === undefined || activation.includes('start')) {
        return true;
    }

    const shown = shownViews(useDocument.getState());
    const canvases = [focusedCanvas().getState(), ...shown.flatMap((view) => liveCanvas(view.id) ?? [])];
    const nodeKeys = canvases.flatMap((canvas) => Object.values(canvas.nodes).flatMap((node) => extensionKeyOf(node.raw) ?? []));
    const viewKeys = shown.flatMap((view) => viewKeyOf(view) ?? []);
    const files = [...useFiles.getState().tabs.map((tab) => tab.key), ...shown.flatMap((view) => (view.kind === 'file' ? [view.path] : []))].map((path) =>
        path.toLowerCase()
    );

    return activation.some((event) => {
        const [kind, value = ''] = event.split(':');
        const key = `${extensionId}/${value}`;

        return kind === 'node'
            ? nodeKeys.includes(key)
            : kind === 'view'
              ? viewKeys.includes(key)
              : kind === 'file' && files.some((path) => path.endsWith(`.${value.toLowerCase()}`));
    });
}

function tabKeys(tabs: readonly { key: string }[]): string {
    return tabs.map((tab) => tab.key).join('\n');
}

// What of the views on screen an activation reads, so an edit inside one asks nothing.
function shownKey(state: Shown): string {
    return shownViews(state)
        .map((view) => `${view.id} ${view.kind} ${viewKeyOf(view) ?? (view.kind === 'file' ? view.path : '')}`)
        .join('\n');
}

// A node that came, or one that became another extension's type; a node that only moved asks nothing.
function nodesMayActivate(state: CanvasState, previous: CanvasState): boolean {
    return (
        state.nodes !== previous.nodes &&
        Object.entries(state.nodes).some(([id, node]) => {
            const before = previous.nodes[id];

            return before === undefined || (before.raw !== node.raw && extensionKeyOf(before.raw) !== extensionKeyOf(node.raw));
        })
    );
}

// A burst, such as a pasted group of nodes or a project opening its tabs, asks once.
const SETTLE_MS = 100;

/*
 * Calls back once one of those may have become true: after a node came in any canvas on screen, the views on screen
 * changed, also without the focus moving, or a tab opened.
 */
export function watchActivation(check: () => void): () => void {
    let timer: ReturnType<typeof setTimeout> | null = null;
    let shown = shownKey(useDocument.getState());
    const soon = (): void => {
        if (timer === null) {
            timer = setTimeout(() => {
                timer = null;
                check();
            }, SETTLE_MS);
        }
    };
    const stops = [
        defaultCanvases.subscribe((_viewId, state, previous) => {
            if (nodesMayActivate(state, previous)) {
                soon();
            }
        }),
        // The canvas a project reads while no view of its own has the focus.
        defaultCanvases.blank.subscribe((state, previous) => {
            if (nodesMayActivate(state, previous)) {
                soon();
            }
        }),
        // A canvas that opened in a cell, whose nodes may already be in.
        defaultCanvases.subscribeShape(soon),
        useDocument.subscribe((state) => {
            const next = shownKey(state);

            if (next !== shown) {
                shown = next;
                soon();
            }
        }),
        // Only which files are open, not what changes inside a tab.
        useFiles.subscribe((state, previous) => {
            if (state.tabs !== previous.tabs && tabKeys(state.tabs) !== tabKeys(previous.tabs)) {
                soon();
            }
        })
    ];

    return () => {
        stops.forEach((stop) => stop());

        if (timer !== null) {
            clearTimeout(timer);
        }
    };
}
