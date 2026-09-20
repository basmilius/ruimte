import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import type { Connection } from './connections';
import type { Transport } from './transport';

const ConnectionContext = createContext<Connection | null>(null);

/*
 * The daemon of the open project. What is inside asks for no endpoint id, it inherits the connection,
 * so a panel or a node never has to be told which machine it is on.
 */
export function ConnectionProvider({ connection, children }: { connection: Connection; children: ReactNode }): ReactElement {
    return <ConnectionContext.Provider value={connection}>{children}</ConnectionContext.Provider>;
}

/* Null outside a workspace, which is where the palette, the settings and the toasts live. */
export const useOptionalConnection = (): Connection | null => useContext(ConnectionContext);

/* Throws outside a provider on purpose. A component that needs a daemon has to sit in a workspace. */
export const useConnection = (): Connection => {
    const connection = useContext(ConnectionContext);
    if (!connection) {
        throw new Error('This component reads a daemon, so it has to be rendered inside a workspace');
    }
    return connection;
};

export const useTransport = (): Transport => useConnection().transport;
