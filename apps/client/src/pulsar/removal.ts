import { LOCAL_ENDPOINT_ID, type Endpoint } from '@/state/endpoints';

/*
 * The rows a signed-in client drops because a person took their machine off the account: removed on
 * the account means removed from every client signed in to it. The row of this machine stays, since
 * it is where the app runs rather than something it connected to.
 */
export const rowsRemovedFromAccount = (endpoints: readonly Endpoint[], removedMachineIds: readonly string[]): string[] =>
    endpoints
        .filter((endpoint) => endpoint.id !== LOCAL_ENDPOINT_ID && removedMachineIds.includes(endpoint.daemonId ?? endpoint.id))
        .map((endpoint) => endpoint.id);
