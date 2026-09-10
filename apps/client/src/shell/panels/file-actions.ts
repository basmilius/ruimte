import { createContext, useContext } from 'react';

export interface FileActions {
    /* Which tab this is, the key `state/files.ts` names it by. */
    key: string;
    /* Absolute on the daemon's machine. */
    path: string;
    name: string;
    /* Reads the file again, which is what the toolbar's Refresh does. */
    refresh(): void;
}

/*
 * What the toolbar's overflow menu can do to the file under it. The viewer owns the read, the
 * renderers draw whatever it found, and the toolbar sits inside them: a context is what gets the
 * read back down to the menu without every renderer passing it along.
 */
export const FileActionsContext = createContext<FileActions | null>(null);

/* Null outside the viewer, where a toolbar has no file to act on. */
export const useFileActions = (): FileActions | null => useContext(FileActionsContext);
