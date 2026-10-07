import type { DatabaseAction } from '@adecore/database';
import { openNewConsole } from '@/database/console-file';
import { useDatabasePanel } from '@/database/state';
import { applyDatabaseAction, type DatabaseTabAction } from '@/database/tabs';
import { useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';

export interface ActOptions {
    /* The tab whose view asked, so a designer that saved a table can become the designer of that table. */
    source?: string | null;
    /* False leaves the keyboard where it is, such as in the explorer a row was opened from. */
    focus?: boolean;
}

/* A database tab opened the way a file opens: in the files cell, which comes on screen, under the same limit. */
export function openDatabaseTab(action: DatabaseTabAction, options: ActOptions = {}): void {
    const files = useFiles.getState();
    const next = applyDatabaseAction(files, action, useSettings.getState().filesTabLimit, () => crypto.randomUUID(), files.keepsOpen, options.source ?? null);
    files.show(next, { focus: options.focus !== false });
}

/* What a database view asks of the app: a tab, a console file, or the connections dialog. */
export function actOnDatabase(action: DatabaseAction, options: ActOptions = {}): void {
    switch (action.kind) {
        case 'manage-connection':
            useDatabasePanel.getState().openConnections(action.connectionId);
            return;
        case 'open-console':
            void openNewConsole({ connectionId: action.connectionId, ...(action.schema === undefined ? {} : { schema: action.schema }) }, action.sql);
            return;
        default:
            openDatabaseTab(action, options);
    }
}
