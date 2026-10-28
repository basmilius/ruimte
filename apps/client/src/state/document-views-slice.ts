import {
    emptyCanvasView,
    isDesignView,
    isOpenableView,
    withDuplicatedView,
    withMovedView,
    withRenamedView,
    withView,
    withViewIcon,
    withoutView,
    type ProjectView
} from '@ruimte/contracts';
import { closeTab, collapseTabHosts, locateView, singleLayout } from '@/shell/split';
import { nextId } from '@/state/canvas';
import type { DocumentState } from '@/state/document';
import { keptNotice, type DocumentKit } from '@/state/document-model';

/* The list of views: adding, renaming, deleting with an undo, duplicating and reordering them. */
export function createDocumentViewsSlice({
    set,
    get,
    commit,
    write
}: DocumentKit): Pick<
    DocumentState,
    | 'addCanvasView'
    | 'addSeparatorView'
    | 'addSubheaderView'
    | 'addDrawingView'
    | 'addDiagramView'
    | 'addFileView'
    | 'addDatabaseView'
    | 'addStandaloneView'
    | 'addArtifactView'
    | 'addDesignChat'
    | 'renameView'
    | 'setViewIcon'
    | 'deleteView'
    | 'trashView'
    | 'restoreView'
    | 'purgeTrash'
    | 'duplicateView'
    | 'moveView'
> {
    /* Takes a view out of the list and off the grid. A trashed one is no edit yet: the file keeps it until it is purged. */
    const removeView = (id: string, trash: boolean): boolean => {
        const state = get();
        const at = state.views.findIndex((view) => view.id === id);
        const result = withoutView(state.exportViews(), id);
        if (result === null) {
            return false;
        }
        const { views, removed } = result;
        const { [id]: local, ...viewLocal } = { ...state.viewLocal, ...state.exportLocal().views };
        const standing = state.layout === null ? null : locateView(state.layout, id);
        /* The cell it stood in falls away and the neighbors grow into it. Only when it was
           the last cell is a view picked: the nearest one under it, or the last one over it. */
        const next = views.slice(at).find(isOpenableView) ?? views.filter(isOpenableView).at(-1);
        // Only its tab goes when the view stood in a host; the other tabs of the cell stay where they are.
        const stood =
            state.layout === null || standing === null
                ? null
                : { before: state.layout, after: collapseTabHosts(closeTab(state.layout, id) ?? (next ? singleLayout(next.id) : null), views) };
        set({
            views,
            viewLocal,
            viewNotice: keptNotice(state.viewNotice, views),
            ...(trash ? { trashed: [...state.trashed, { view: removed, index: at, local, layout: stood }] } : { edits: state.edits + 1 })
        });
        if (stood !== null) {
            commit(stood.after);
        }
        return true;
    };

    /* A new view goes last in the list; everything but a divider opens on the spot. */
    const addView = (view: ProjectView, opens: boolean): string => {
        set((state) => ({ views: withView(state.exportViews(), view), edits: state.edits + 1 }));
        if (opens) {
            get().setActiveView(view.id);
        }
        return view.id;
    };

    return {
        addCanvasView(name) {
            return addView(emptyCanvasView(nextId('view'), name), true);
        },

        addSeparatorView() {
            // A line in the list, not a place to go, so nothing opens on it.
            return addView({ kind: 'separator', id: nextId('separator') }, false);
        },

        addSubheaderView(name) {
            // A heading over the rows under it, which is a row that divides the list, not a place to go.
            return addView({ kind: 'subheader', id: nextId('subheader'), name }, false);
        },

        addDrawingView(name) {
            return addView({ kind: 'drawing', id: nextId('view'), name }, true);
        },

        addDiagramView(name) {
            return addView({ kind: 'diagram', id: nextId('view'), name }, true);
        },

        addFileView(name, path, opens = true) {
            return addView({ kind: 'file', id: nextId('view'), name, path }, opens);
        },

        addDatabaseView(name, table, opens = true) {
            return addView({ kind: 'database', id: nextId('view'), name, ...table }, opens);
        },

        addStandaloneView(request) {
            const id = request.id ?? nextId(request.kind);
            return addView(
                request.kind === 'browser' || request.kind === 'device'
                    ? request.kind === 'browser'
                        ? {
                              kind: 'browser',
                              id,
                              name: request.name,
                              url: request.url,
                              ...(request.browserOwner ? { browserOwner: request.browserOwner } : {})
                          }
                        : { kind: 'device', id, name: request.name, device: request.device }
                    : request.kind === 'design'
                      ? { kind: 'design', id, name: request.name, node: request.node, path: request.path }
                      : { kind: request.kind, id, name: request.name, node: request.node },
                true
            );
        },

        addDesignChat(viewId, chat) {
            const views = get().views;
            const design = views.find((view) => view.id === viewId);
            if (design === undefined || !isDesignView(design)) {
                return false;
            }
            write(views.map((view) => (view === design ? { ...design, chats: [...(design.chats ?? []), chat] } : view)));
            return true;
        },

        addArtifactView(name, artifact, opens = true) {
            return addView({ kind: 'artifact', id: nextId('view'), name, node: { artifact } }, opens);
        },

        renameView(id, name, source = 'user') {
            write(withRenamedView(get().views, id, name, source));
        },

        setViewIcon(id, icon) {
            write(withViewIcon(get().views, id, icon));
        },

        deleteView(id) {
            removeView(id, false);
        },

        trashView(id) {
            return removeView(id, true);
        },

        restoreView(id) {
            const state = get();
            const entry = state.trashed.find((candidate) => candidate.view.id === id);
            if (!entry) {
                return false;
            }
            const views = [...state.exportViews()];
            views.splice(Math.min(entry.index, views.length), 0, entry.view);
            // One update, so the view is never in neither list and nothing watching reads it as gone.
            set({
                views,
                viewLocal: entry.local === undefined ? state.viewLocal : { ...state.viewLocal, [id]: entry.local },
                trashed: state.trashed.filter((candidate) => candidate !== entry)
            });
            if (entry.layout === null) {
                return true;
            }
            if (get().layout === entry.layout.after) {
                commit(entry.layout.before);
            } else {
                get().setActiveView(id);
            }
            return true;
        },

        purgeTrash(id) {
            const { trashed } = get();
            const going = trashed.filter((entry) => id === undefined || entry.view.id === id);
            if (going.length > 0) {
                set((state) => ({ trashed: trashed.filter((entry) => !going.includes(entry)), edits: state.edits + 1 }));
            }
        },

        duplicateView(id) {
            const copy = withDuplicatedView(get().exportViews(), id, nextId);
            if (copy === null) {
                return null;
            }
            write(copy.views);
            return copy.id;
        },

        moveView(id, toIndex) {
            write(withMovedView(get().exportViews(), id, toIndex));
        }
    };
}
