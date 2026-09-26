import type { ReactElement, ReactNode } from 'react';
import { ChatScopeProvider } from './ChatScopeProvider';
import type { Connection } from './connections';
import { ConnectionContext } from './context';

/* The daemon of the open project, inherited by everything inside, so a panel or a node never has to be told which machine it is on. */
export function ConnectionProvider({ connection, children }: { connection: Connection; children: ReactNode }): ReactElement {
    return (
        <ConnectionContext.Provider value={connection}>
            <ChatScopeProvider>{children}</ChatScopeProvider>
        </ConnectionContext.Provider>
    );
}
