import i18next from 'i18next';
import type { Reachability } from '@ruimte/contracts';
import type { Endpoint } from '@/state/endpoints';
import { listedEndpoints } from '@/state/local-machine';
import type { ConnectionState } from '@/transport';
import { relativeTime } from '@/shell/panels/commit-log';

/*
 * How far away a machine is, in the words a row's tooltip and the About pane show. Each word is read
 * when a row draws it, because this module is imported before `initI18n()` has run: a string fixed
 * here would stay English for the life of the window.
 */
export const reachabilityLabel = (reach: Reachability): string => i18next.t(`shell:connection.reachability.${reach}`);

export interface MachineInfo {
    /* What this client calls the daemon it points at (`endpoints.ts`). */
    endpointLabel: string;
    /* What the daemon calls itself, its hostname unless it was given a label. */
    machineLabel: string | null;
    reachability: Reachability | null;
    platform: string | null;
}

/* The socket's state in the words the tooltip shows. The countdown needs a clock, so it comes in;
   `now` as null leaves the countdown off, which is what a screen reader wants to hear. */
export const describeConnection = (connection: ConnectionState, now: number | null): string => {
    if (connection.status === 'open') {
        return connection.relayed === true ? i18next.t('shell:connection.relayed') : i18next.t('shell:connection.connected');
    }
    if (connection.noLink === true) {
        return i18next.t('shell:connection.noLink');
    }
    if (connection.attempts === 0) {
        return connection.status === 'connecting' ? i18next.t('shell:connection.connecting') : i18next.t('shell:connection.disconnected');
    }
    const attempt = i18next.t('shell:connection.reconnecting', { attempt: connection.attempts });
    if (connection.status === 'connecting') {
        return attempt;
    }
    if (connection.retryAt === null) {
        return i18next.t('shell:connection.disconnected');
    }
    if (now === null) {
        return attempt;
    }
    const seconds = Math.max(0, Math.ceil((connection.retryAt - now) / 1000));
    return i18next.t('shell:connection.reconnectingIn', { attempt, seconds });
};

/*
 * The machines the tooltip lists: every one with a link, in the order of the list. The local row of
 * the web client is no machine, so it is left out even when something put it in the pool.
 */
export const tooltipMachines = <T extends Pick<Endpoint, 'id'>>(endpoints: readonly T[], connected: readonly string[], local?: boolean): T[] =>
    listedEndpoints(endpoints, local).filter((endpoint) => connected.includes(endpoint.id));

/* When a machine without a link last had one here; null when this client never reached it. */
export const describeLastSeen = (at: number | null, now: number): string | null =>
    at === null ? null : i18next.t('shell:connection.lastSeen', { ago: relativeTime(Math.floor(at / 1000), Math.floor(now / 1000)) });

/* The machine on the other end. A daemon on this machine is named after the machine itself,
   because "This machine · bas-mbp" says the same thing twice. */
export const describeMachine = (info: MachineInfo): string => {
    if (info.reachability === 'loopback') {
        if (info.platform === 'darwin') {
            return i18next.t('shell:connection.thisMac');
        }
        return info.machineLabel ?? info.endpointLabel;
    }
    if (!info.machineLabel || info.machineLabel === info.endpointLabel) {
        return info.endpointLabel;
    }
    return `${info.endpointLabel} · ${info.machineLabel}`;
};

export const describeVersion = (version: string | null): string => i18next.t('shell:connection.version', { version: version ?? '-' });

export const describePing = (latency: number | null): string =>
    i18next.t('shell:connection.ping', { latency: latency === null ? '-' : `${Math.round(latency)} ms` });
