import { useCallback, useMemo, type ReactNode } from 'react';
import { DatabaseProvider, type DatabaseAction } from '@adecore/database';
import { databaseClientFor } from '@/database/client';
import { databaseFiles, databaseStorage } from '@/database/environment';
import { useDatabaseTabs } from '@/database/state';
import { desktop } from '@/desktop/bridge';
import { endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { useConnection } from '@/transport/context';

function localStorageArea(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

/*
 * The client of the workspace and what Ruimte hands every database view: where a table or a console
 * opens, where the views keep their settings, the file dialogs, and numbers in the person's region.
 * `source` names the tab whose views ask. `keepTableFocus` leaves the keyboard where it is when a table
 * opens, for a tree whose next arrow key is its own; a console or a designer takes it either way.
 */
export function RuimteDatabaseProvider({
    source = null,
    keepTableFocus = false,
    children
}: {
    source?: string | null;
    keepTableFocus?: boolean;
    children: ReactNode;
}) {
    const { endpointId } = useConnection();
    const projectId = useProject((state) => state.current?.projectId ?? '');
    const client = useMemo(() => databaseClientFor(endpointKey(endpointId, projectId)), [endpointId, projectId]);
    const storage = useMemo(() => databaseStorage(localStorageArea(), endpointId, projectId), [endpointId, projectId]);
    const files = useMemo(() => databaseFiles(endpointId, desktop()), [endpointId]);
    const onAction = useCallback(
        (action: DatabaseAction) => useDatabaseTabs.getState().act(action, { source, focus: !(keepTableFocus && action.kind === 'open-table') }),
        [source, keepTableFocus]
    );

    return (
        <DatabaseProvider client={client} onAction={onAction} storage={storage} files={files} numberNotation="region">
            {children}
        </DatabaseProvider>
    );
}
