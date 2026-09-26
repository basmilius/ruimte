import { useMemo } from 'react';
import clsx from 'clsx';
import i18next from 'i18next';
import { useTranslation } from 'react-i18next';
import { LoaderCircle, TriangleAlert, Unplug } from 'lucide-react';
import { ChatScopeContext } from '@ruimte/agents-react/scope';
import { useUsageStore } from '@ruimte/agents-react/state/usage';
import { UsageDialog as Frame } from '@ruimte/agents-react/usage/UsageDialog';
import { UsagePage } from '@ruimte/agents-react/usage/UsagePage';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { useEndpoints } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import { useEndpointId } from '@/state/keys';
import { useServers } from '@/state/server';
import { useUi } from '@/state/ui';
import { chatScopeOf } from '@/transport/chat-scope';
import { useEndpointConnection, useMachineHold } from '@/transport/status';
import { usageEndpointFor } from '@/shell/usage/picker';
import { ErrorBoundary } from '@ruimte/ui/ErrorBoundary';
import { Icon } from '@ruimte/ui/Icon';
import { Select } from '@ruimte/ui/Select';

/*
 * A machine that is not answering says so, rather than leaving the page on a skeleton that never
 * fills: the numbers come from one daemon and a socket that is down is the whole story.
 */
function MachineNote({ endpointId, stale }: { endpointId: string; stale: boolean }) {
    const { t } = useTranslation('usage');
    const machine = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.label) ?? t('machineNote.unnamed');
    const { status, noLink } = useEndpointConnection(endpointId);
    if (status === 'open') {
        return null;
    }
    const connecting = noLink !== true && status === 'connecting';
    const line =
        noLink === true
            ? t('machineNote.disconnected', { machine })
            : connecting
              ? t('machineNote.connecting', { machine })
              : t('machineNote.silent', { machine });
    const icon = noLink === true ? Unplug : connecting ? LoaderCircle : TriangleAlert;
    return (
        <div role="status" className="flex items-center gap-2 rounded-lg border border-border bg-surface-raised px-3 py-2 text-xs text-text">
            <Icon
                icon={icon}
                size={14}
                className={clsx(
                    'shrink-0',
                    connecting && 'animate-spin text-text-muted',
                    !connecting && noLink !== true && 'text-status-error',
                    noLink === true && 'text-text-muted'
                )}
            />
            <span className="grow">{stale ? `${line} ${t('machineNote.stale')}` : line}</span>
        </div>
    );
}

/* One entry per machine this client knows, in the order of the list; with one machine there is nothing to pick. */
function MachinePicker({ endpointId }: { endpointId: string }) {
    const { t } = useTranslation('usage');
    const stored = useEndpoints((s) => s.endpoints);
    const servers = useServers((s) => s.byEndpoint);
    const endpoints = useMemo(() => listedEndpoints(stored), [stored]);
    if (endpoints.length < 2) {
        return null;
    }
    return (
        <Select
            value={endpointId}
            items={endpoints.map((endpoint) => ({
                value: endpoint.id,
                label: endpoint.label,
                icon: <MachineGlyph icon={servers[endpoint.id]?.icon ?? null} size={14} />
            }))}
            onValueChange={(id) => useUsageStore.getState().choose(id)}
            label={t('dialog.machine')}
            align="end"
        />
    );
}

/* The page of one machine, held while the dialog shows it, like its dialog in the Machines pane. Asking for its numbers is an explicit action. */
function MachinePage({ endpointId }: { endpointId: string }) {
    const endpoint = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId) ?? null);
    useMachineHold(endpoint);
    return <UsagePage pickers={<MachinePicker endpointId={endpointId} />} notice={(stale) => <MachineNote endpointId={endpointId} stale={stale} />} />;
}

/*
 * One dialog with a machine picker rather than one per machine: the numbers are a person's spend and
 * a person works on several machines. Everything under it reads the picked machine as its scope,
 * which is what keeps the limit bars in the sidebar on the machine the work is on.
 */
function Body() {
    const workspaceId = useEndpointId();
    const chosen = useUsageStore((s) => s.chosen);
    const known = useEndpoints((s) => s.endpoints);
    const endpointId = usageEndpointFor(
        chosen,
        listedEndpoints(known).map((endpoint) => endpoint.id),
        workspaceId
    );

    return (
        <ChatScopeContext.Provider value={chatScopeOf(endpointId)}>
            {/* Remounts on a switch, so no effect of the machine that left outlives it. */}
            <MachinePage key={endpointId} endpointId={endpointId} />
        </ChatScopeContext.Provider>
    );
}

/* What both CLIs cost and how much of the plan is left, over one whole machine at a time. */
export function UsageDialog() {
    const open = useUi((s) => s.usageOpen);
    return (
        <Frame open={open} onOpenChange={(next) => useUi.getState().setUsageOpen(next)}>
            <ErrorBoundary label={i18next.t('agent-usage:dialog.failed')} className="grow">
                <Body />
            </ErrorBoundary>
        </Frame>
    );
}
