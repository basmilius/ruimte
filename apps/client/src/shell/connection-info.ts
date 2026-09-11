import type { Reachability } from '@ruimte/contracts';
import type { ConnectionState } from '@/transport';

/* How far away a machine is, in the words a row's tooltip and the About pane show. */
export const REACHABILITY_LABELS: Record<Reachability, string> = {
    loopback: 'On this machine',
    lan: 'On the local network',
    tunnel: 'Through a tunnel',
    public: 'On the public internet'
};

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
        return 'Connected';
    }
    if (connection.attempts === 0) {
        return connection.status === 'connecting' ? 'Connecting' : 'Disconnected';
    }
    const attempt = `Reconnecting, attempt ${connection.attempts}`;
    if (connection.status === 'connecting') {
        return attempt;
    }
    if (connection.retryAt === null) {
        return 'Disconnected';
    }
    if (now === null) {
        return attempt;
    }
    const seconds = Math.max(0, Math.ceil((connection.retryAt - now) / 1000));
    return `${attempt}, next try in ${seconds}s`;
};

/* The machine on the other end. A daemon on this machine is named after the machine itself,
   because "This machine · bas-mbp" says the same thing twice. */
export const describeMachine = (info: MachineInfo): string => {
    if (info.reachability === 'loopback') {
        if (info.platform === 'darwin') {
            return 'This Mac';
        }
        return info.machineLabel ?? info.endpointLabel;
    }
    if (!info.machineLabel || info.machineLabel === info.endpointLabel) {
        return info.endpointLabel;
    }
    return `${info.endpointLabel} · ${info.machineLabel}`;
};

export const describeVersion = (version: string | null): string => `Version ${version ?? '-'}`;

export const describePing = (latency: number | null): string => `Ping ${latency === null ? '-' : `${Math.round(latency)} ms`}`;
