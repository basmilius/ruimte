import { ComputerIndicator } from '@/computer/ComputerIndicator';
import { DesignActions } from '@/design/DesignActions';
import { useNodeComputerSession } from '@/computer/indicator';
import { TerminalDictationButton } from '@/dictation/TerminalDictationButton';
import { useDictation } from '@/dictation/controller';
import { isLooseView, type CellView } from '@/shell/cell-view';
import { runtimeModeHint, runtimeModeLabel } from '@adecore/agents-react/chat';
import { ForkPill } from '@/chat/ForkPill';
import { PlanPill } from '@/plan/PlanPill';
import { BrowserToolbar } from '@/nodes/BrowserBody';
import { DeviceToolbar } from '@/devices/DeviceBody';
import { SessionPorts } from '@/terminal/SessionPorts';
import { useSessionPortControl } from '@/terminal/session-port-controls';
import { useNodeHost } from '@/nodes/node-host';
import { useFileToolbarSlot } from '@/shell/panels/file-toolbar-slot';
import { isFileTab } from '@/state/files';
import { useEndpointId } from '@/state/keys';
import { useHasPlans } from '@/state/plans';
import { Pill, Tooltip } from '@adecore/ui';
import { chatIdOf, hostIdOf, KINDS_WITH_TOOLBAR, modeOf, useIsFork } from '@/shell/view-toolbar';

export function ViewToolbar({ view, focused }: { view: CellView | null; focused: boolean }) {
    const host = useNodeHost(hostIdOf(view));
    const { mount } = useFileToolbarSlot();
    const dictationEnabled = useDictation((state) => state.model?.enabled === true);
    const forked = useIsFork(view);
    const planned = useHasPlans(chatIdOf(view));
    const endpointId = useEndpointId();
    const ports = useSessionPortControl(view?.kind === 'terminal' ? view.id : '');
    const operating = useNodeComputerSession(endpointId, view?.kind === 'terminal' ? view.id : chatIdOf(view)) !== null;

    // The active renderer of a file, a diagram or an artifact portals its controls up into this slot after the body mounts.
    const slot = <div ref={mount} className="flex min-w-0 grow items-center justify-end gap-1" />;
    if (isLooseView(view)) {
        return isFileTab(view.tab) ? slot : null;
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
            <div className="flex min-w-0 grow items-center justify-end gap-2">
                <DeviceToolbar id={view.id} />
            </div>
        );
    }
    if (view.kind === 'file' || view.kind === 'diagram' || view.kind === 'artifact') {
        return slot;
    }
    if (view.kind === 'design') {
        return (
            <div className="flex min-w-0 grow items-center gap-1.5">
                {forked && <ForkPill chatId={view.id} />}
                {planned && <PlanPill chatId={view.id} />}
                {operating && <ComputerIndicator nodeId={view.id} />}
                <DesignActions view={view} />
            </div>
        );
    }
    if (view.kind === 'chat') {
        if (!forked && !planned && !operating) {
            return null;
        }
        return (
            <div className="flex min-w-0 grow items-center gap-1.5">
                {forked && <ForkPill chatId={view.id} />}
                {planned && <PlanPill chatId={view.id} />}
                {operating && <ComputerIndicator nodeId={view.id} />}
            </div>
        );
    }
    const mode = modeOf(host);
    if (!mode && !dictationEnabled && !operating && !ports) {
        return null;
    }
    return (
        <div className="flex min-w-0 grow items-center gap-1.5">
            <SessionPorts id={view.id} />
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
