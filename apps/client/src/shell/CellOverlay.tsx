import { useContext, useLayoutEffect, useMemo, useRef, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { focusCellOfView } from '@/browser/guest-focus';
import { cellElement, subscribeCells } from '@/shell/cell-rects';
import { shownViewIdsIn } from '@/shell/split';
import { useDocument } from '@/state/document';
import { CellViewContext } from '@/state/workspace-stores';

/*
 * What a cell draws over the pages parked above it. A <webview> loses its page the moment it changes
 * parent, and a state-preserving move does not save it either, so the parking layer keeps one place
 * in the document and everything that has to stand over a page is drawn here instead, in a box that
 * follows the cell it belongs to (`browser/WebviewParking.tsx`).
 */

/* Slots per cell in a fixed order, since the order of portals into one box is the order they
   mounted in. The cell's own chrome stands over the view's, the way it did inside the cell. */
type Slot = 'view' | 'cell' | 'drop';

const hosts = new Map<string, Record<Slot | 'box', HTMLElement>>();
const listeners = new Set<() => void>();

function announce(): void {
    for (const listener of [...listeners]) {
        listener();
    }
}

function subscribeHosts(listener: () => void): () => void {
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
    };
}

/* Draws its children over the pages, in the cell around it. Outside a cell they stay where they are. The `drop` slot is the one
   that is not clipped to the cell's body, so a drop indicator can reach up over the bar. */
export function CellOverlay({ slot, children }: { readonly slot: Slot; readonly children: ReactNode }) {
    const viewId = useContext(CellViewContext);
    const host = useSyncExternalStore(subscribeHosts, () => (viewId === null ? null : (hosts.get(viewId)?.[slot] ?? null)));
    return host === null ? <>{children}</> : createPortal(children, host);
}

function OverlayBox({ viewId }: { readonly viewId: string }) {
    const box = useRef<HTMLDivElement>(null);
    const view = useRef<HTMLDivElement>(null);
    const cell = useRef<HTMLDivElement>(null);
    const drop = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        hosts.set(viewId, { box: box.current!, view: view.current!, cell: cell.current!, drop: drop.current! });
        announce();
        return () => {
            hosts.delete(viewId);
            announce();
        };
    }, [viewId]);

    return (
        <div
            ref={box}
            className="pointer-events-none absolute top-0 left-0 origin-top-left"
            style={{ visibility: 'hidden' }}
            /* The cell under this box never sees the press, so chrome outside the focused cell says
               for itself which cell the keyboard goes to. */
            onPointerDownCapture={() => focusCellOfView(viewId)}
            onFocusCapture={() => focusCellOfView(viewId)}
        >
            <div className="pointer-events-none absolute inset-0 overflow-hidden">
                {/* Isolated, so a z-index inside one slot never reaches past it. */}
                <div ref={view} className="pointer-events-none absolute inset-0 isolate" />
                <div ref={cell} className="pointer-events-none absolute inset-0 isolate" />
            </div>
            <div ref={drop} className="pointer-events-none absolute inset-0 isolate" />
        </div>
    );
}

/* The layer itself, mounted once over the parked pages. */
export function CellOverlayLayer() {
    const layout = useDocument((s) => s.layout);
    const ids = useMemo(() => (layout === null ? [] : shownViewIdsIn(layout)), [layout]);
    const root = useRef<HTMLDivElement>(null);

    useLayoutEffect(() => {
        const place = (): void => {
            const box = root.current?.getBoundingClientRect();
            for (const [viewId, slots] of hosts) {
                const element = slots.box;
                const cell = box === undefined ? null : cellElement(viewId);
                if (element === null) {
                    continue;
                }
                if (cell === null) {
                    element.style.visibility = 'hidden';
                    continue;
                }
                const rect = cell.getBoundingClientRect();
                element.style.visibility = 'visible';
                element.style.transform = `translate(${rect.left - box!.left}px, ${rect.top - box!.top}px)`;
                element.style.width = `${rect.width}px`;
                element.style.height = `${rect.height}px`;
            }
        };
        place();
        const offHosts = subscribeHosts(place);
        const offCells = subscribeCells(place);
        // A cell moves with the window as well, and a resize moves no state at all.
        window.addEventListener('resize', place);
        return () => {
            offHosts();
            offCells();
            window.removeEventListener('resize', place);
        };
    }, [ids]);

    return (
        <div ref={root} className="pointer-events-none absolute inset-0 overflow-hidden">
            {ids.map((viewId) => (
                <OverlayBox key={viewId} viewId={viewId} />
            ))}
        </div>
    );
}
