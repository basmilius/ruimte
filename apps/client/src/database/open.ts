import type { DatabaseAction } from '@adecore/database';
import { openNewConsole } from '@/database/console-file';
import { useDatabasePanel } from '@/database/state';
import { applyDatabaseAction, databaseViewFor, type DatabaseTabAction } from '@/database/tabs';
import { showView } from '@/project/views';
import { useDocument } from '@/state/document';
import { useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { canSplit, type CellAt, type SplitZone } from '@/shell/split';

export interface ActOptions {
    /* The tab whose view asked, so a designer that saved a table can become the designer of that table. */
    source?: string | null;
    /* False leaves the keyboard where it is, such as in the explorer a row was opened from. */
    focus?: boolean;
}

/*
 * A database tab opened the way a file opens: a loose view in a tab host, under the same limit. A table
 * the project already keeps as a view of its own is shown instead, so it is never in the grid twice.
 */
export function openDatabaseTab(action: DatabaseTabAction, options: ActOptions = {}): void {
    const kept = databaseViewFor(useDocument.getState().views, action);
    if (kept !== undefined) {
        showView(kept.id);
        return;
    }
    const files = useFiles.getState();
    const next = applyDatabaseAction(files, action, () => crypto.randomUUID(), options.source ?? null);
    files.show(next, useSettings.getState().filesTabLimit, { focus: options.focus !== false });
}

export function dropDatabaseTab(action: DatabaseTabAction, at: CellAt, zone: SplitZone, index: number | null = null): boolean {
    const document = useDocument.getState();
    const kept = databaseViewFor(document.views, action);
    if (kept !== undefined) {
        if (zone === 'center') {
            return document.dropViewAsTab(kept.id, at, index);
        }
        if (document.layout === null || !canSplit(document.layout, at, zone, kept.id)) {
            return false;
        }
        document.dropViewAt(kept.id, at, zone);
        return true;
    }
    const files = useFiles.getState();
    const next = applyDatabaseAction(files, action, () => crypto.randomUUID());
    return files.dropTab(next, useSettings.getState().filesTabLimit, at, zone, index);
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
