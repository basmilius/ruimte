import type { ConnectionState } from '@/transport/transport';

/* Whether the link of the workspace's machine is down and at least one try to bring it back failed; a link that is merely opening says nothing yet. */
export const machineLost = (connection: Pick<ConnectionState, 'status' | 'attempts' | 'failure'>): boolean =>
    connection.status !== 'open' && (connection.attempts > 0 || Boolean(connection.failure));
