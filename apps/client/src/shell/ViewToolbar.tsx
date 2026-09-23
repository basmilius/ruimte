import { TerminalDictationButton } from '@/dictation/TerminalDictationButton';
import { useDictation } from '@/dictation/controller';
import type { RuntimeMode } from '@ruimte/contracts';
import { type ProjectViewKind } from '@ruimte/contracts';
import { isFilesView, type CellView } from '@/shell/files-view';
import { useCellView } from '@/shell/use-cell-view';
import { FileTabs } from '@/shell/panels/FileTabs';
import { RUNTIME_MODES, runtimeModeHint, runtimeModeLabel } from '@/chat/runtime-modes';
import { useSubagentTrail } from '@/chat/subagent-view';
import { ForkPill } from '@/chat/ui/ForkPill';
import { PlanPill } from '@/plan/PlanPill';
import { SubagentBreadcrumb } from '@/chat/ui/SubagentControls';
import { useChatRow } from '@/state/chats';
import { BrowserToolbar } from '@/nodes/BrowserBody';
import { DeviceToolbar } from '@/devices/DeviceBody';
import { useNodeHost, type NodeHost } from '@/nodes/node-host';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useDocument } from '@/state/document';
import { useHasPlans } from '@/state/plans';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'device', 'terminal', 'file', 'diagram', 'chat']);

const modeOf = (host: NodeHost | null): RuntimeMode | undefined => RUNTIME_MODES.find((mode) => mode === host?.runtimeMode);

/* The id a hook that only knows the document may be asked about; a canvas has its own store and the files are in neither. */
const hostIdOf = (view: CellView | null): string => (view !== null && view.kind !== 'canvas' && !isFilesView(view) ? view.id : '');

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

const useIsFork = (view: CellView | null): boolean => useChatRow(view?.kind === 'chat' ? view.id : '', (row) => row?.info.forkOf !== undefined);

/* The view the window's toolbar speaks for: the one in the focused cell. */
export const useToolbarView = (): CellView | null => useCellView(useDocument((s) => s.activeViewId));

// A single view uses the window toolbar; split views render the same controls in each cell toolbar.
export function ViewToolbar({
    view,
    focused,
    chatTitle
}: {
    view: CellView | null;
    focused: boolean;
    /* For a bar that does not draw the view's name itself, so the breadcrumb of a chat opens with it. */
    chatTitle?: string;
}) {
    const host = useNodeHost(hostIdOf(view));
    const { mount } = useFileToolbarSlot();
    const dictationEnabled = useDictation((state) => state.model?.enabled === true);
    const hasSubagents = useShowsSubagents(view);
    const forked = useIsFork(view);
    const planned = useHasPlans(view?.kind === 'chat' ? view.id : '');

    /* The tabs take the slack and the file's own controls close the bar, the way they do for a
       file view: one strip that says which files are open and what can be done to the one in front. */
    if (isFilesView(view)) {
        return (
            <div className="flex h-full min-w-0 grow items-center gap-1">
                <FileTabs />
                <div ref={mount} className="flex shrink-0 items-center gap-1" />
            </div>
        );
    }
    if (!view || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return null;
    }
    if (view.kind === 'browser') {
        return (
            <div className="flex min-w-0 grow items-center gap-2">
                <BrowserToolbar id={view.id} focused={focused} />
            </div>
        );
    }
    if (view.kind === 'device') {
        return (
            <div className="flex min-w-0 grow items-center justify-end">
                <DeviceToolbar id={view.id} />
            </div>
        );
    }
    if (view.kind === 'file' || view.kind === 'diagram') {
        // The active renderer portals its controls here after the body mounts.
        return <div ref={mount} className="flex min-w-0 grow items-center justify-end gap-1" />;
    }
    if (view.kind === 'chat') {
        if (!hasSubagents && !forked && !planned) {
            return null;
        }
        return (
            <div className="flex min-w-0 grow items-center gap-1.5">
                {hasSubagents && <SubagentBreadcrumb chatId={view.id} title={chatTitle} className="grow" />}
                {forked && <ForkPill chatId={view.id} />}
                {planned && <PlanPill chatId={view.id} />}
            </div>
        );
    }
    const mode = modeOf(host);
    if (!mode && !dictationEnabled) {
        return null;
    }
    return (
        <div className="flex min-w-0 grow items-center gap-1.5">
            {mode && (
                <Tooltip label={runtimeModeHint(mode)}>
                    <Pill>{runtimeModeLabel(mode)}</Pill>
                </Tooltip>
            )}
            <div className="ml-auto flex shrink-0 items-center">
                <TerminalDictationButton terminalId={view.id} />
            </div>
        </div>
    );
}
