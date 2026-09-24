import { createContext, useContext } from 'react';
import type { Connection } from './connections';
import type { Transport } from './transport';

export const ConnectionContext = createContext<Connection | null>(null);

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
