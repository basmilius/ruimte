import { createContext, useContext, type ReactElement, type ReactNode } from 'react';
import { WorkspaceStoresContext, type WorkspaceStores } from '@/state/workspace-stores';
import type { Connection } from './connections';
import type { Transport } from './transport';

const ConnectionContext = createContext<Connection | null>(null);

/*
 * A workspace: one open project, the daemon it lives on and the stores that hold it. What is inside
 * asks for neither, it inherits both, which is what lets two projects from two machines be on screen
 * at once without a single endpoint id threaded through a panel or a node.
 */
export function WorkspaceProvider({ connection, stores, children }: { connection: Connection; stores: WorkspaceStores; children: ReactNode }): ReactElement {
    return (
        <ConnectionContext.Provider value={connection}>
            <WorkspaceStoresContext.Provider value={stores}>{children}</WorkspaceStoresContext.Provider>
        </ConnectionContext.Provider>
    );
}

/* Null outside a workspace, which is where the palette, the settings and the toasts live. */
export const useOptionalConnection = (): Connection | null => useContext(ConnectionContext);

/* Throws outside a provider on purpose: a component that needs a daemon has to sit in a workspace. */
export const useConnection = (): Connection => {
    const connection = useContext(ConnectionContext);
    if (!connection) {
        throw new Error('This component reads a daemon, so it has to be rendered inside a workspace');
    }
    return connection;
};

export const useTransport = (): Transport => useConnection().transport;
