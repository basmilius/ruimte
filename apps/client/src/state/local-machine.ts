import { machineMode } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/*
 * Only the desktop shell can read the local secret. A browser may be served beside a daemon, but it
 * still reaches machines as a signed-in client and must not present its origin as one. A shell
 * without the mode field ran a machine, and one told to run none follows the path the station takes.
 */
export function hasLocalMachine(): boolean {
    return machineMode() === 'local';
}

/* The rows a list of machines shows: every row, without the local one where no daemon is behind it. */
export function listedEndpoints<T extends Pick<Endpoint, 'id'>>(endpoints: readonly T[], local: boolean = hasLocalMachine()): T[] {
    return local ? [...endpoints] : endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID);
}

/* Whether a machine is the one this app runs, the only one whose folders a person here works in directly. */
export function isThisMachine(endpointId: string, local: boolean = hasLocalMachine()): boolean {
    return local && endpointId === LOCAL_ENDPOINT_ID;
}

/* Whether the machine the client points at is one a person picked, rather than the idle local row of the web client. */
export function isRealMachine(endpointId: string, local: boolean = hasLocalMachine()): boolean {
    return local || endpointId !== LOCAL_ENDPOINT_ID;
}

/*
 * The machine a start screen keeps a link to: this machine on the desktop, a socket on loopback, so
 * its projects read as they stand. Every other machine is a channel over the broker and connects
 * only when it is used.
 */
export function startScreenMachine<T extends Pick<Endpoint, 'id'>>(endpoints: readonly T[], local: boolean = hasLocalMachine()): T | null {
    return local ? (endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID) ?? null) : null;
}
