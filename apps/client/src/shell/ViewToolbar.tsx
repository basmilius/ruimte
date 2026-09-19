import type { RuntimeMode } from '@ruimte/contracts';
import { isCanvasView, type ProjectView, type ProjectViewKind } from '@ruimte/contracts';
import { RUNTIME_MODES, runtimeModeHint, runtimeModeLabel } from '@/chat/runtime-modes';
import { useHasSubagentControls, useSubagentTrail } from '@/chat/subagent-view';
import { ForkPill } from '@/chat/ui/ForkPill';
import { PlanPill } from '@/plan/PlanPill';
import { SubagentBreadcrumb, SubagentButton } from '@/chat/ui/SubagentControls';
import { useChatRow } from '@/state/chats';
import { BrowserToolbar } from '@/nodes/BrowserBody';
import { DeviceToolbar } from '@/devices/DeviceBody';
import { useNodeHost, type NodeHost } from '@/nodes/node-host';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { activeViewOf, useDocument } from '@/state/document';
import { useHasPlans } from '@/state/plans';
import { BTN_GROUP } from '@/ui/classes';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

/* The kinds that put something in the toolbar; the bar draws its separators around that part. */
const KINDS_WITH_TOOLBAR = new Set<ProjectViewKind>(['browser', 'device', 'terminal', 'file', 'diagram', 'chat']);

const modeOf = (host: NodeHost | null): RuntimeMode | undefined => RUNTIME_MODES.find((mode) => mode === host?.runtimeMode);

/* Whether a view has content for the bar, which is what the separators around it wait for. A browser
   always brings its navigation, a file and a diagram their own controls, a terminal only the mode of an agent
   running in it, a chat only its sub-agents once it has any, where it was forked from and its plans; a canvas brings nothing. */
export const useHasViewToolbar = (view: ProjectView | null): boolean => {
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');
    const subagents = useHasSubagentControls(view?.kind === 'chat' ? view.id : '');
    const forked = useIsFork(view);
    const planned = useHasPlans(view?.kind === 'chat' ? view.id : '');
    if (view === null || !KINDS_WITH_TOOLBAR.has(view.kind)) {
        return false;
    }
    if (view.kind === 'chat') {
        return subagents || forked || planned;
    }
    return view.kind === 'browser' || view.kind === 'device' || view.kind === 'file' || view.kind === 'diagram' || modeOf(host) !== undefined;
};

const useIsFork = (view: ProjectView | null): boolean => useChatRow(view?.kind === 'chat' ? view.id : '', (row) => row?.info.forkOf !== undefined);

/* Whether a chat view shows its sub-agents in its place, where its title turns into the first crumb and needs no separator after it. */
export const useShowsSubagents = (view: ProjectView | null): boolean => useSubagentTrail(view?.kind === 'chat' ? view.id : '').trail.length > 0;

/* The view the window's toolbar speaks for: the one in the focused cell. */
export const useToolbarView = (): ProjectView | null => useDocument((s) => activeViewOf(s));

// A single view uses the window toolbar; split views render the same controls in each cell toolbar.
export function ViewToolbar({
    view,
    focused,
    chatTitle
}: {
    view: ProjectView | null;
    focused: boolean;
    /* For a bar that does not draw the view's name itself, so the breadcrumb of a chat opens with it. */
    chatTitle?: string;
}) {
    const host = useNodeHost(view && !isCanvasView(view) ? view.id : '');
    const { mount } = useFileToolbarSlot();
    const hasSubagents = useHasSubagentControls(view?.kind === 'chat' ? view.id : '');
    const forked = useIsFork(view);
    const planned = useHasPlans(view?.kind === 'chat' ? view.id : '');

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
                {hasSubagents && (
                    <div className={`${BTN_GROUP} ml-auto shrink-0`}>
                        <SubagentButton chatId={view.id} />
                    </div>
                )}
            </div>
        );
    }
    const mode = modeOf(host);
    if (!mode) {
        return null;
    }
    return (
        <div className="flex min-w-0 grow items-center gap-1.5">
            <Tooltip label={runtimeModeHint(mode)}>
                <Pill>{runtimeModeLabel(mode)}</Pill>
            </Tooltip>
        </div>
    );
}
