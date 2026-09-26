import type { ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { MachineGlyph } from '@/endpoint/MachineGlyph';
import { describeConnection, describeLastSeen, describePing, reachabilityLabel } from '@/shell/connection-info';
import { MasterItem } from '@/shell/settings/MasterDetail';
import { useMachineIcon } from '@/shell/settings/machine-icon';
import { nameOf, reachLabel, type MachineEntry } from '@/shell/settings/machine-list';
import { useMinute } from '@/shell/usage/limits';
import { brokerRouteOf, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useServers } from '@/state/server';
import type { TransportStatus } from '@/transport';
import { useLatency } from '@/transport/ping';
import { useEndpointConnection, useLastSeenAt } from '@/transport/status';
import { Tooltip } from '@ruimte/ui/Tooltip';

const DOT: Record<TransportStatus, string> = {
    open: 'bg-status-idle',
    connecting: 'bg-status-needs-you',
    closed: 'bg-status-error'
};

// A hollow dot is a machine with no link here, which says nothing about whether it runs.
const HOLLOW = 'border border-border-strong bg-surface-raised';

/* The icon tile of a row with its connection as a dot in the corner; the tooltip carries the address and what matters when it does not answer. */
function Tile({ entry, dot, tooltip }: { entry: MachineEntry; dot: string; tooltip: ReactNode }) {
    const icon = useMachineIcon(entry);
    return (
        <Tooltip label={tooltip}>
            <span className="relative grid size-7.5 shrink-0 place-items-center rounded-lg bg-surface-hover">
                <MachineGlyph icon={icon} size={16} className="text-text-muted" />
                <span className={clsx('absolute -right-0.5 -bottom-0.5 size-2.5 rounded-full ring-2 ring-surface-raised', dot)} />
            </span>
        </Tooltip>
    );
}

function ConnectedTile({ entry, endpoint }: { entry: MachineEntry; endpoint: Endpoint }) {
    const { t } = useTranslation('settings');
    const connection = useEndpointConnection(endpoint.id);
    const latency = useLatency(endpoint.id);
    const lastSeenAt = useLastSeenAt(endpoint.id);
    const reachability = useServers((s) => s.byEndpoint[endpoint.id]?.reachability ?? endpoint.reachability);
    const now = useMinute();
    const lastSeen = connection.noLink === true ? describeLastSeen(lastSeenAt, now) : null;

    const tooltip = (
        <span className="flex flex-col items-start gap-0.5">
            <span>{describeConnection(connection, null)}</span>
            {lastSeen !== null && <span className="text-text-muted">{lastSeen}</span>}
            <span className="text-text-muted">{reachabilityLabel(reachability)}</span>
            <span className="font-mono text-text-muted">{endpoint.httpBaseUrl === '' ? t('machines.dot.brokerOnly') : endpoint.httpBaseUrl}</span>
            {endpoint.direct === true && (
                <span className="text-text-muted">{brokerRouteOf(endpoint) === null ? t('machines.dot.direct') : t('machines.dot.directBroker')}</span>
            )}
            <span className="text-text-muted">{describePing(latency)}</span>
        </span>
    );

    return <Tile entry={entry} dot={connection.noLink === true ? HOLLOW : DOT[connection.status]} tooltip={tooltip} />;
}

/* Why this client cannot reach the machine the way it should, for the line under the name. */
const useRowFailure = (endpoint: Endpoint | null): string | null => {
    const { t } = useTranslation('settings');
    const mismatch = useEndpoints((s) => (endpoint ? s.mismatched[endpoint.id] : undefined));
    const connection = useEndpointConnection(endpoint?.id ?? '');
    if (endpoint === null) {
        return null;
    }
    if (mismatch !== undefined) {
        return t('machines.mismatch');
    }
    // A socket reports a failure only for a refusal (another wire version), so any failure is worth the line.
    return connection.status !== 'open' ? (connection.failure ?? null) : null;
};

/* One machine in the list of the Account pane: its icon with how it answers, its name, and how this client reaches it. */
export function MachineListItem({ entry, selected, onSelect }: { entry: MachineEntry; selected: boolean; onSelect(): void }) {
    const { t } = useTranslation('settings');
    const failure = useRowFailure(entry.endpoint);
    const connection = useEndpointConnection(entry.endpoint?.id ?? '');
    const reach = reachLabel(entry);
    const status = entry.endpoint === null ? t('machines.notOpened') : describeConnection(connection, null);

    return (
        <MasterItem selected={selected} onSelect={onSelect}>
            {entry.endpoint === null ? (
                <Tile entry={entry} dot={HOLLOW} tooltip={t('machines.notOpened')} />
            ) : (
                <ConnectedTile entry={entry} endpoint={entry.endpoint} />
            )}
            <span className="flex min-w-0 grow flex-col">
                <span className="truncate text-sm text-text">{nameOf(entry)}</span>
                <span className="text-xs break-words text-text-muted">{connection.relayed === true ? t('machines.viaRelay', { reach }) : reach}</span>
                {failure !== null && (
                    <span className="text-xs break-words text-status-error" role="alert">
                        {failure}
                    </span>
                )}
                <span className="sr-only">{status}</span>
            </span>
        </MasterItem>
    );
}
