import { createContext, useContext, useMemo } from 'react';
import { chatHost, type FileRef } from '../../host';

/*
 * The folder a relative reference in rendered text counts from: a chat's own cwd, which is a
 * worktree as often as it is the project, or the folder of the file an app is drawing. Null where
 * nobody said, and there only an absolute path is a link.
 */
export const FileLinkContext = createContext<string | null>(null);

export const useFileLinkCwd = (): string | null => useContext(FileLinkContext);

/* The reference a piece of text names, only where this spot on screen could open it. */
export const useFileLinkTarget = (text: string): FileRef | null => {
    const cwd = useFileLinkCwd();
    return useMemo(() => chatHost().fileLinks?.target(text, cwd) ?? null, [text, cwd]);
};

/* A reference followed, the way the app opens a file or a folder. */
export const openFileLink = (cwd: string | null, ref: FileRef): void => {
    chatHost().fileLinks?.open(cwd, ref);
};
