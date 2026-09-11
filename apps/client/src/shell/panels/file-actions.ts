import { createContext, useContext } from 'react';
import type { FileSurfaceKind } from '@/shell/panels/FileActionItems';

export interface FileActions {
    /* Absolute on the daemon's machine. */
    path: string;
    name: string;
    /* Which surface the file is drawn on, since two of the menu's items would point at themselves. */
    on: FileSurfaceKind;
    /* The tab this file is open in, the key `state/files.ts` names it by. Absent on a node and on a
       view of its own, which are a path and nothing else: there is no tab to pin or close. */
    tabKey?: string;
    /* Reads the file again, which is what the toolbar's Refresh does. */
    refresh(): void;
}

/*
 * What the toolbar's overflow menu can do to the file under it. `FileBody` owns the read, the
 * renderers draw whatever it found, and the toolbar sits inside them: a context is what gets the
 * read back down to the menu without every renderer passing it along.
 */
export const FileActionsContext = createContext<FileActions | null>(null);

/* Null where a toolbar has no file under it to act on. */
export const useFileActions = (): FileActions | null => useContext(FileActionsContext);
