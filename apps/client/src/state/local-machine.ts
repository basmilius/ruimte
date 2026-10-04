import { isDesktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/*
 * Only the desktop shell can read the local secret. A browser may be served beside a daemon, but it
 * still reaches machines as a signed-in client and must not present its origin as one.
 */
export function hasLocalMachine(): boolean {
    return isDesktop();
}

/* The rows a list of machines shows: every row, without the local one where no daemon is behind it. */
export function listedEndpoints<T extends Pick<Endpoint, 'id'>>(endpoints: readonly T[], local: boolean = hasLocalMachine()): T[] {
    return local ? [...endpoints] : endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID);
}

/* Whether the machine the client points at is one a person picked, rather than the idle local row of the web client. */
export function isRealMachine(endpointId: string, local: boolean = hasLocalMachine()): boolean {
    return local || endpointId !== LOCAL_ENDPOINT_ID;
}
