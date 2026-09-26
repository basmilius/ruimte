import { ComputerIndicator } from '@/computer/ComputerIndicator';
import { useNodeComputerSession } from '@/computer/indicator';
import { TerminalDictationButton } from '@/dictation/TerminalDictationButton';
import { useDictation } from '@/dictation/controller';
import { isFilesView, type CellView } from '@/shell/files-view';
import { FileTabs } from '@/shell/panels/FileTabs';
import { runtimeModeHint, runtimeModeLabel } from '@ruimte/agents-react/chat/runtime-modes';
import { ForkPill } from '@/chat/ForkPill';
import { PlanPill } from '@/plan/PlanPill';
import { SubagentBreadcrumb } from '@ruimte/agents-react/chat/ui/SubagentControls';
import { BrowserToolbar } from '@/nodes/BrowserBody';
import { DeviceToolbar } from '@/devices/DeviceBody';
import { useNodeHost } from '@/nodes/node-host';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { useEndpointId } from '@/state/keys';
import { useHasPlans } from '@/state/plans';
import { Pill } from '@ruimte/ui/Pill';
import { Tooltip } from '@ruimte/ui/Tooltip';
import { hostIdOf, KINDS_WITH_TOOLBAR, modeOf, useIsFork, useShowsSubagents } from '@/shell/view-toolbar';

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
    const endpointId = useEndpointId();
    const operating = useNodeComputerSession(endpointId, view?.kind === 'chat' || view?.kind === 'terminal' ? view.id : '') !== null;

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
        if (!hasSubagents && !forked && !planned && !operating) {
            return null;
        }
        return (
            <div className="flex min-w-0 grow items-center gap-1.5">
                {hasSubagents && <SubagentBreadcrumb chatId={view.id} title={chatTitle} className="grow" />}
                {forked && <ForkPill chatId={view.id} />}
                {planned && <PlanPill chatId={view.id} />}
                {operating && <ComputerIndicator nodeId={view.id} />}
            </div>
        );
    }
    const mode = modeOf(host);
    if (!mode && !dictationEnabled && !operating) {
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
                <ComputerIndicator nodeId={view.id} />
                <TerminalDictationButton terminalId={view.id} />
            </div>
        </div>
    );
}
