import { isDesktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/*
 * Only the desktop shell can read the local secret. A browser may be served beside a daemon, but it
 * still reaches machines as a paired or signed-in client and must not present its origin as one.
 */
export const hasLocalMachine = (native: boolean = isDesktop()): boolean => native;

/* The rows a list of machines shows: every row, without the local one where no daemon is behind it. */
export const listedEndpoints = <T extends Pick<Endpoint, 'id'>>(endpoints: readonly T[], local: boolean = hasLocalMachine()): T[] =>
    local ? [...endpoints] : endpoints.filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID);

/* Whether the machine the client points at is one a person picked, rather than the idle local row of the web client. */
export const isRealMachine = (endpointId: string, local: boolean = hasLocalMachine()): boolean => local || endpointId !== LOCAL_ENDPOINT_ID;
