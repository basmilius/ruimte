import { useCallback, useMemo, type ReactNode } from 'react';
import { DatabaseProvider, type DatabaseAction, type DatabaseNotice } from '@adecore/database';
import { databaseClientFor } from '@/database/client';
import { databaseFiles, databaseStorage } from '@/database/environment';
import { actOnDatabase } from '@/database/open';
import { desktop } from '@/desktop/bridge';
import { endpointKey } from '@/state/keys';
import { useToasts } from '@/state/toasts';
import { useProject } from '@/state/project';
import { useConnection } from '@/transport/context';

/* The news of a database view, such as an export that finished, among the app's other toasts. */
function showNotice(notice: DatabaseNotice): void {
    useToasts.getState().show({
        kind: notice.tone,
        title: notice.title,
        ...(notice.description === undefined ? {} : { description: notice.description, output: notice.description }),
        ...(notice.action === undefined ? {} : { action: notice.action })
    });
}

function localStorageArea(): Storage | null {
    try {
        return typeof localStorage === 'undefined' ? null : localStorage;
    } catch {
        return null;
    }
}

/*
 * The client of the workspace and what Ruimte hands every database view: where a table or a console
 * opens, where their news goes (the toasts), where the views keep their settings, the file dialogs, and
 * numbers in the person's region.
 * `keepTableFocus` leaves the keyboard where it is when a table opens, for a tree whose next arrow key
 * is its own; a console or a designer takes it either way.
 */
export function RuimteDatabaseProvider({ keepTableFocus = false, children }: { keepTableFocus?: boolean; children: ReactNode }) {
    const { endpointId } = useConnection();
    const projectId = useProject((state) => state.current?.projectId ?? '');
    const client = useMemo(() => databaseClientFor(endpointKey(endpointId, projectId)), [endpointId, projectId]);
    const storage = useMemo(() => databaseStorage(localStorageArea(), endpointId, projectId), [endpointId, projectId]);
    const files = useMemo(() => databaseFiles(endpointId, desktop()), [endpointId]);
    const onAction = useCallback(
        (action: DatabaseAction) => actOnDatabase(action, { source: null, focus: !(keepTableFocus && action.kind === 'open-table') }),
        [keepTableFocus]
    );

    return (
        <DatabaseProvider client={client} onAction={onAction} onNotice={showNotice} storage={storage} files={files} numberNotation="region">
            {children}
        </DatabaseProvider>
    );
}

/* Inside a provider above, the actions of one tab's views, so a designer that saved its table turns that tab into the table's designer. */
export function DatabaseTabProvider({ tabKey, children }: { tabKey: string; children: ReactNode }) {
    const onAction = useCallback((action: DatabaseAction) => actOnDatabase(action, { source: tabKey, focus: true }), [tabKey]);
    return <DatabaseProvider onAction={onAction}>{children}</DatabaseProvider>;
}
