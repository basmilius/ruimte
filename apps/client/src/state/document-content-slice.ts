import { withFlags, isCanvasView } from '@ruimte/contracts';
import { migrateFilesCell, NO_LOOSE } from '@/shell/legacy-files-cell';
import { focusedViewId, layoutOf, viewIdsIn } from '@/shell/split';
import { forgetCameraHistories } from '@/state/camera-history';
import type { DocumentState } from '@/state/document';
import { keptNotice, localOfView, looseIdsOf, openEditors, settledOn, splitTrash, type DocumentKit } from '@/state/document-model';

/* The project as a whole: loaded, read again, merged with another writer, and handed back to be saved. */
export function createDocumentContentSlice({
    set,
    get,
    peers
}: DocumentKit): Pick<
    DocumentState,
    'load' | 'reload' | 'setShared' | 'setFlags' | 'takeAccounts' | 'applyMerge' | 'heldNodeIds' | 'exportViews' | 'fileViews' | 'exportLocal'
> {
    return {
        load(document, local, loose = NO_LOOSE) {
            const kept = splitTrash(document?.views ?? [], get().trashed);
            const views = kept.views;
            const state = get();
            // A view deleted since the local state was written has nothing left to stand for.
            const viewLocal = Object.fromEntries(Object.entries(local?.views ?? {}).filter(([viewId]) => views.some((view) => view.id === viewId)));
            // The loose views on screen stay through a reload; a project that opens brings its own with its panels.
            const standing = state.reloading ? looseIdsOf(state) : loose.keys;
            const stored = local ?? { activeViewId: null, layout: undefined };
            // A file written before views could stand side by side reads as one cell on the view it named.
            const layout = layoutOf(state.reloading ? stored : migrateFilesCell(stored, loose), views, standing);
            const settled = settledOn(views, viewLocal, layout, {
                lastCanvasViewId: views.find(isCanvasView)?.id ?? null,
                lastHostViewId: state.reloading ? state.lastHostViewId : null
            });
            // Another project is another set of views, so a banner about the one that just left goes with it.
            set({
                ...settled,
                emptyLayout: local?.emptyLayout === true,
                maximized: null,
                viewNotice: null,
                loading: true,
                edits: 0,
                shared: document?.shared ?? [],
                flags: document?.flags ?? {},
                accounts: document?.accounts ?? {},
                trashed: kept.trashed
            });
            // The project that was here goes first, editors and all, so nothing of it may show through.
            peers.canvases.keep([]);
            if (!state.reloading) {
                forgetCameraHistories();
            }
            openEditors(views, viewLocal, layout === null ? [] : viewIdsIn(layout), settled.activeViewId, peers);
            set({ loading: false });
        },

        reload(document, local) {
            set({ reloading: true });
            get().load(document, local);
            set({ reloading: false });
        },

        setShared(id, shared) {
            set((state) => {
                const without = state.shared.filter((viewId) => viewId !== id);
                return { shared: shared ? [...without, id] : without, edits: state.edits + 1 };
            });
        },

        takeAccounts(accounts) {
            set({ accounts });
        },

        setFlags(ids, color) {
            const flags = withFlags(get().flags, ids, color);
            if (flags !== null) {
                set((state) => ({ flags, edits: state.edits + 1 }));
            }
        },

        applyMerge(merged, canvases, shared, flags) {
            const { views, trashed } = splitTrash(merged, get().trashed);
            set((state) => ({ views, shared, flags, trashed, merging: true, viewNotice: keptNotice(state.viewNotice, views) }));
            for (const [viewId, patch] of Object.entries(canvases)) {
                peers.canvases.peek(viewId)?.getState().applyExternal(patch);
            }
            set({ merging: false });
        },

        heldNodeIds() {
            return new Set(peers.canvases.live().flatMap(([, store]) => store.getState().heldNodeIds()));
        },

        exportViews() {
            const { views } = get();
            const live = peers.canvases.live();
            if (live.length === 0) {
                return views;
            }
            // Every editor on screen writes itself back, not only the one the focus happens to be in.
            const content = new Map(live.map(([viewId, store]) => [viewId, store.getState().exportContent()]));
            return views.map((view) => {
                const held = isCanvasView(view) ? content.get(view.id) : undefined;
                return held ? { ...view, ...held } : view;
            });
        },

        fileViews() {
            const views = [...get().exportViews()];
            // Newest first, since each index was read off the list the older deletions had already left.
            for (const entry of [...get().trashed].reverse()) {
                views.splice(Math.min(entry.index, views.length), 0, entry.view);
            }
            return views;
        },

        exportLocal() {
            const { viewLocal, views, layout, emptyLayout } = get();
            const open = new Set([
                ...peers.canvases.live().map(([viewId]) => viewId),
                ...peers.drawings.live().map(([viewId]) => viewId),
                ...peers.diagrams.live().map(([viewId]) => viewId)
            ]);
            const next = { ...viewLocal };
            for (const viewId of open) {
                next[viewId] = localOfView(
                    views.find((view) => view.id === viewId),
                    peers
                );
            }
            return {
                activeViewId: layout === null ? null : focusedViewId(layout),
                views: next,
                ...(layout !== null ? { layout } : emptyLayout ? { emptyLayout: true } : {})
            };
        }
    };
}
