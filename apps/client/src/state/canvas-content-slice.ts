import type { CanvasPatch } from '@/project/merge';
import type { CanvasState } from '@/state/canvas';
import { hiddenIn, patchSnapshot, snapshotOf, type CanvasGet, type CanvasNode, type CanvasSet } from '@/state/canvas-model';
import { finishLoad } from '@/state/editors';

/* Spread over what the editor holds, so what only lives here (a browser's status) stays. */
function mergedIn<T extends { id: string }>(held: Record<string, T>, removed: readonly string[], arrived: readonly T[]): Record<string, T> {
    const next = { ...held };
    for (const id of removed) {
        delete next[id];
    }
    for (const item of arrived) {
        const known = next[item.id];
        next[item.id] = known ? { ...known, ...item } : item;
    }
    return next;
}

/* The content as a whole: a view loaded in, a change of another writer taken in, the content handed back, and undo. */
export function createCanvasContentSlice(set: CanvasSet, get: CanvasGet): Pick<CanvasState, 'loadView' | 'applyExternal' | 'exportContent' | 'undo' | 'redo'> {
    return {
        loadView(view, local) {
            const nodes = view ? Object.fromEntries(view.nodes.map((node) => [node.id, node])) : {};
            const texts = view ? Object.fromEntries(view.texts.map((text) => [text.id, text])) : {};
            const lines = Object.fromEntries((view?.lines ?? []).map((line) => [line.id, line]));
            set({
                loading: true,
                viewId: view?.id ?? null,
                nodes,
                order: view ? view.nodes.map((node) => node.id) : [],
                texts,
                lines,
                linesPresent: view?.lines !== undefined,
                lineTool: null,
                edges: view?.edges ?? [],
                layouts: view?.layouts ?? [],
                linkDraft: null,
                hidden: hiddenIn(nodes, texts, lines),
                selection: [],
                bodyFocusId: null,
                maximizedId: null,
                editingTextId: null,
                resizing: null,
                navigationId: null,
                gapMove: null,
                panning: false,
                gesturing: false,
                past: [],
                future: [],
                pendingCamera: null,
                // A reload in place hands over no locks and keeps the ones it has.
                ...(local?.locks ? { locks: local.locks } : {})
            });
            finishLoad(set, get, local);
        },
        applyExternal(patch) {
            set((s) => {
                const arrived: CanvasPatch = {
                    ...patch,
                    nodes: patch.nodes.filter((node) => s.nodes[node.id] === undefined),
                    texts: patch.texts.filter((text) => s.texts[text.id] === undefined),
                    lines: patch.lines?.filter((line) => s.lines[line.id] === undefined),
                    edges: patch.edges.filter((edge) => !s.edges.some((held) => held.id === edge.id))
                };
                const reshapes =
                    arrived.nodes.length + arrived.texts.length + arrived.edges.length + (arrived.lines?.length ?? 0) > 0 ||
                    patch.removed.nodes.length + patch.removed.texts.length + patch.removed.edges.length + (patch.removed.lines?.length ?? 0) > 0;
                const gone = new Set([...patch.removed.nodes, ...patch.removed.texts, ...patch.removed.edges, ...(patch.removed.lines ?? [])]);
                const lines = mergedIn(s.lines, patch.removed.lines ?? [], patch.lines ?? []);
                const nodes: Record<string, CanvasNode> = mergedIn(s.nodes, patch.removed.nodes, patch.nodes);
                const texts = mergedIn(s.texts, patch.removed.texts, patch.texts);
                const arriving = new Map(patch.edges.map((edge) => [edge.id, edge]));
                const edges = s.edges
                    .filter((edge) => !gone.has(edge.id))
                    .map((edge) => (arriving.has(edge.id) ? { ...edge, ...arriving.get(edge.id)! } : edge));
                const present = new Set(edges.map((edge) => edge.id));
                edges.push(...patch.edges.filter((edge) => !present.has(edge.id)));
                const hidden = hiddenIn(nodes, texts, lines);
                const lost = (id: string | null | undefined): boolean => id !== null && id !== undefined && gone.has(id);
                return {
                    merging: true,
                    nodes,
                    order: patch.order.filter((id) => nodes[id] !== undefined),
                    texts,
                    lines,
                    linesPresent: s.linesPresent || (patch.lines?.length ?? 0) > 0,
                    edges,
                    layouts: patch.layouts ?? s.layouts,
                    hidden,
                    ...(reshapes
                        ? {
                              past: s.past.map((snapshot) => patchSnapshot(snapshot, arrived, patch.nodes)),
                              future: s.future.map((snapshot) => patchSnapshot(snapshot, arrived, patch.nodes)),
                              ...(s.gapMove === null ? {} : { gapMove: { ...s.gapMove, snapshot: patchSnapshot(s.gapMove.snapshot, arrived, patch.nodes) } })
                          }
                        : {}),
                    ...(gone.size === 0
                        ? {}
                        : {
                              selection: s.selection.filter((id) => !gone.has(id) && !hidden.has(id)),
                              bodyFocusId: lost(s.bodyFocusId) ? null : s.bodyFocusId,
                              editingTextId: lost(s.editingTextId) ? null : s.editingTextId,
                              resizing: lost(s.resizing) ? null : s.resizing,
                              linkDraft: lost(s.linkDraft?.from) ? null : s.linkDraft
                          })
                };
            });
            set({ merging: false });
        },
        exportContent() {
            const { nodes, order, texts, edges, layouts, lines } = get();
            return {
                nodes: order.map((id) => nodes[id]!).map(({ status: _status, ...node }) => node),
                texts: Object.values(texts),
                edges,
                ...(get().linesPresent || Object.keys(lines).length > 0 ? { lines: Object.values(lines) } : {}),
                layouts
            };
        },
        undo() {
            const s = get();
            if (s.gapMove !== null) {
                return;
            }
            const previous = s.past.at(-1);
            if (!previous) {
                return;
            }
            set({
                ...previous,
                lines: previous.lines ?? {},
                hidden: hiddenIn(previous.nodes, previous.texts, previous.lines),
                past: s.past.slice(0, -1),
                future: [snapshotOf(s), ...s.future],
                selection: [],
                bodyFocusId: null
            });
        },
        redo() {
            const s = get();
            if (s.gapMove !== null) {
                return;
            }
            const next = s.future[0];
            if (!next) {
                return;
            }
            set({
                ...next,
                lines: next.lines ?? {},
                hidden: hiddenIn(next.nodes, next.texts, next.lines),
                past: [...s.past, snapshotOf(s)],
                future: s.future.slice(1),
                selection: [],
                bodyFocusId: null
            });
        }
    };
}
