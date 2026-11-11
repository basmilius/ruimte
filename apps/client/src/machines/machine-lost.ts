import type { BackgroundServiceBridge, BackgroundServiceState } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';
import type { ConnectionState } from '@/transport-api/transport';
import { protocolRefusal } from '@/transport/protocol';

/*
 * Whether a machine's link is down for real: it said why, a try to bring it back failed, or it has
 * stayed down past the grace (`DropGrace`). The drop itself already counts one attempt, the one it
 * schedules, so a link that dropped and is on its first try back is a blink, not a machine that went
 * away. A machine closes a socket whose queue filled up, and the next one is open within a second.
 */
export function machineLost(connection: Pick<ConnectionState, 'status' | 'attempts' | 'failure'>, downPastGrace = false): boolean {
    if (connection.status === 'open') {
        return false;
    }
    return Boolean(connection.failure) || connection.attempts > 1 || (connection.attempts > 0 && downPastGrace);
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
