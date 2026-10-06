import type { ProjectViewKind, RuntimeMode } from '@ruimte/contracts';
import { RUNTIME_MODES } from '@adecore/agents-react/chat/runtime-modes';
import { useSubagentTrail } from '@adecore/agents-react/chat/subagent-view';
import { useDictation } from '@/dictation/controller';
import { useNodeHost, type NodeHost } from '@/nodes/node-host';
import { isClientCell, isFilesView, type CellView } from '@/shell/client-cells';
import { useChatRow } from '@adecore/agents-react/state/chats';
import { useHasPlans } from '@/state/plans';

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
export const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'device', 'terminal', 'file', 'diagram', 'chat']);

export function modeOf(host: NodeHost | null): RuntimeMode | undefined {
    return RUNTIME_MODES.find((mode) => mode === host?.runtimeMode);
}

/* The id a hook that only knows the document may be asked about; a canvas has its own store and the cells of this client are in neither. */
export function hostIdOf(view: CellView | null): string {
    return view !== null && view.kind !== 'canvas' && !isClientCell(view) ? view.id : '';
}

/* Whether a chat view shows a sub-agent in its place, where its title turns into the first crumb and needs no separator after it. */
export function useShowsSubagents(view: CellView | null): boolean {
    return useSubagentTrail(view?.kind === 'chat' ? view.id : '').trail.length > 0;
}

/* Whether a view has content for the bar, which is what the separators around it wait for. */
export function useHasViewToolbar(view: CellView | null): boolean {
    const host = useNodeHost(hostIdOf(view));
    const dictationEnabled = useDictation((state) => state.model?.enabled === true);
    const subagents = useShowsSubagents(view);
    const forked = useIsFork(view);
    const planned = useHasPlans(view?.kind === 'chat' ? view.id : '');
    // The tabs are the files' toolbar, so the cell always has one, even with nothing open.
    if (isFilesView(view)) {
        return true;
    }
    // The databases draw their tabs inside the cell, since a strip of `Tabs` carries a line of its own.
    if (view === null || isClientCell(view) || !KINDS_WITH_TOOLBAR.has(view.kind)) {
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
}

/* The kinds whose controls begin right where the name ends. The rest hang their buttons on the right
   of the bar, against the panels: a line beside the name would fence off empty space half a window
   away from anything. */
const LEADING_TOOLBAR_KINDS = new Set<ProjectViewKind>(['browser', 'chat', 'terminal']);

/* Whether the line after the name has anything to fence off. The bar always closes the view's part
   with one, since the panels are right there; this is about the one that opens it. */
export function useViewToolbarLeads(view: CellView | null): boolean {
    const has = useHasViewToolbar(view);
    if (isFilesView(view)) {
        return true;
    }
    return has && view !== null && !isClientCell(view) && LEADING_TOOLBAR_KINDS.has(view.kind);
}

export function useIsFork(view: CellView | null): boolean {
    return useChatRow(view?.kind === 'chat' ? view.id : '', (row) => row?.info.forkOf !== undefined);
}
