import type { ProjectViewKind, RuntimeMode } from '@ruimte/contracts';
import { RUNTIME_MODES } from '@/chat/runtime-modes';
import { useSubagentTrail } from '@/chat/subagent-view';
import { useDictation } from '@/dictation/controller';
import { useNodeHost, type NodeHost } from '@/nodes/node-host';
import { isFilesView, type CellView } from '@/shell/files-view';
import { useCellView } from '@/shell/use-cell-view';
import { useChatRow } from '@/state/chats';
import { useDocument } from '@/state/document';
import { useHasPlans } from '@/state/plans';

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
export const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'device', 'terminal', 'file', 'diagram', 'chat']);

export const modeOf = (host: NodeHost | null): RuntimeMode | undefined => RUNTIME_MODES.find((mode) => mode === host?.runtimeMode);

/* The id a hook that only knows the document may be asked about; a canvas has its own store and the files are in neither. */
export const hostIdOf = (view: CellView | null): string => (view !== null && view.kind !== 'canvas' && !isFilesView(view) ? view.id : '');

/* Whether a chat view shows a sub-agent in its place, where its title turns into the first crumb and needs no separator after it. */
export const useShowsSubagents = (view: CellView | null): boolean => useSubagentTrail(view?.kind === 'chat' ? view.id : '').trail.length > 0;

/* Whether a view has content for the bar, which is what the separators around it wait for. */
export const useHasViewToolbar = (view: CellView | null): boolean => {
    const host = useNodeHost(hostIdOf(view));
    const dictationEnabled = useDictation((state) => state.model?.enabled === true);
    const subagents = useShowsSubagents(view);
    const forked = useIsFork(view);
    const planned = useHasPlans(view?.kind === 'chat' ? view.id : '');
    // The tabs are the files' toolbar, so the cell always has one, even with nothing open.
    if (isFilesView(view)) {
        return true;
    }
    if (view === null || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return false;
    }
    if (view.kind === 'chat') {
        return subagents || forked || planned;
    }
    return (
        (view.kind === 'terminal' && dictationEnabled) ||
        view.kind === 'browser' ||
        view.kind === 'device' ||
        view.kind === 'file' ||
        view.kind === 'diagram' ||
        modeOf(host) !== undefined
    );
};

/* The kinds whose controls begin right where the name ends. The rest hang their buttons on the right
   of the bar, against the panels: a line beside the name would fence off empty space half a window
   away from anything. */
const LEADING_TOOLBAR_KINDS = new Set<ProjectViewKind>(['browser', 'chat', 'terminal']);

/* Whether the line after the name has anything to fence off. The bar always closes the view's part
   with one, since the panels are right there; this is about the one that opens it. */
export const useViewToolbarLeads = (view: CellView | null): boolean => {
    const has = useHasViewToolbar(view);
    if (isFilesView(view)) {
        return true;
    }
    return has && view !== null && LEADING_TOOLBAR_KINDS.has(view.kind);
};

export const useIsFork = (view: CellView | null): boolean => useChatRow(view?.kind === 'chat' ? view.id : '', (row) => row?.info.forkOf !== undefined);

/* The view the window's toolbar speaks for: the one in the focused cell. */
export const useToolbarView = (): CellView | null => useCellView(useDocument((s) => s.activeViewId));
