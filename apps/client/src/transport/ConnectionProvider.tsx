import type { ReactElement, ReactNode } from 'react';
import type { Connection } from './connections';
import { ConnectionContext } from './context';

/*
 * The daemon of the open project. What is inside asks for no endpoint id, it inherits the connection,
 * so a panel or a node never has to be told which machine it is on.
 */
export function ConnectionProvider({ connection, children }: { connection: Connection; children: ReactNode }): ReactElement {
    return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>;
}
