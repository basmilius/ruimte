import type { ProjectViewKind, RuntimeMode } from '@ruimte/contracts';
import { RUNTIME_MODES } from '@adecore/agents-react/chat';
import { useDictation } from '@/dictation/controller';
import { useNodeHost, type NodeHost } from '@/nodes/node-host';
import { isLooseView, type CellView } from '@/shell/cell-view';
import { useChatRow } from '@adecore/agents-react/state';
import { isFileTab } from '@/state/files';
import { useHasPlans } from '@/state/plans';
import { useSessionPortControl } from '@/terminal/session-port-controls';

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
export const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'device', 'terminal', 'file', 'diagram', 'chat', 'artifact', 'design']);

/* A view whose session is an AI chat, which shows its fork and its plans in the bar. */
export function chatIdOf(view: CellView | null): string {
    return view?.kind === 'chat' || view?.kind === 'design' ? view.id : '';
}

export function modeOf(host: NodeHost | null): RuntimeMode | undefined {
    return RUNTIME_MODES.find((mode) => mode === host?.runtimeMode);
}

/* The id a hook that only knows the document may be asked about; a canvas has its own store and a loose view is in neither. */
export function hostIdOf(view: CellView | null): string {
    return view !== null && view.kind !== 'canvas' && !isLooseView(view) ? view.id : '';
}

/* Whether a view has content for the bar, which is what the separators around it wait for. */
export function useHasViewToolbar(view: CellView | null): boolean {
    const host = useNodeHost(hostIdOf(view));
    const dictationEnabled = useDictation((state) => state.model?.enabled === true);
    const forked = useIsFork(view);
    const planned = useHasPlans(chatIdOf(view));
    const ports = useSessionPortControl(view?.kind === 'terminal' ? view.id : '');
    // A file's controls are portaled into the bar; a database or an artifact tab draws its own toolbar in the body.
    if (isLooseView(view)) {
        return isFileTab(view.tab);
    }
    if (view === null || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return false;
    }
    if (view.kind === 'chat') {
        return forked || planned;
    }
    return view.kind !== 'terminal' || dictationEnabled || ports !== null || modeOf(host) !== undefined;
}

/* The kinds whose controls start right after the name. The rest sit at the right of the bar, where a
   line after the name would fence off empty space. */
const LEADING_TOOLBAR_KINDS = new Set<ProjectViewKind>(['browser', 'chat', 'terminal']);

/* Whether the line after the name has anything to fence off. The bar always closes the view's part
   with one, since the panels are right there; this is about the one that opens it. */
export function useViewToolbarLeads(view: CellView | null): boolean {
    const has = useHasViewToolbar(view);
    return has && view !== null && !isLooseView(view) && LEADING_TOOLBAR_KINDS.has(view.kind);
}

export function useIsFork(view: CellView | null): boolean {
    return useChatRow(chatIdOf(view), (row) => row?.info.forkOf !== undefined);
}
