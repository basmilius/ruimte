import type { BackgroundServiceBridge, BackgroundServiceState } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import type { ConnectionState } from '@/transport-api/transport';
import { protocolRefusal } from '@/transport/protocol';

/* Whether the link of the workspace's machine is down and at least one try to bring it back failed; a link that is merely opening says nothing yet. */
export function machineLost(connection: Pick<ConnectionState, 'status' | 'attempts' | 'failure'>): boolean {
    return connection.status !== 'open' && (connection.attempts > 0 || Boolean(connection.failure));
}

/*
 * Whether the lost screen offers to restart this computer's own machine: it was refused as older
 * while the shell holds a restart a person put off. Without a pending restart the shell's
 * `restartNow` does nothing, as with a service the command line set up or the dev app.
 */
export function offersMachineRestart(
    endpointId: string,
    connection: Pick<ConnectionState, 'failure'>,
    bridge: Pick<BackgroundServiceBridge, 'restartNow'> | null,
    service: Pick<BackgroundServiceState, 'pendingRestart'> | null
): boolean {
    return (
        endpointId === LOCAL_ENDPOINT_ID &&
        bridge?.restartNow !== undefined &&
        (service?.pendingRestart ?? null) !== null &&
        connection.failure === protocolRefusal('daemon-older')
    );
}
