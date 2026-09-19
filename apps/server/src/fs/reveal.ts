import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import { CodedError } from '../coded-error.ts';

type RevealErrorCode = 'path-not-found' | 'reveal-failed';

export class RevealError extends CodedError<RevealErrorCode> {}

/* The file manager's command line per platform: a folder opens, a file is selected inside its folder. */
export const revealCommand = (path: string, isDirectory: boolean, platform: NodeJS.Platform = process.platform): string[] => {
    switch (platform) {
        case 'darwin':
            return isDirectory ? ['open', path] : ['open', '-R', path];
        case 'win32':
            return isDirectory ? ['explorer', path] : ['explorer', `/select,${path}`];
        default:
            // No portable "select this file"; the folder is the best a Linux desktop offers.
            return ['xdg-open', isDirectory ? path : dirname(path)];
    }
};

/* Shows a path in Finder, Explorer or the desktop's file manager, detached from the daemon. */
export const revealInFileManager = async (path: string, platform: NodeJS.Platform = process.platform): Promise<void> => {
    let isDirectory: boolean;
    try {
        isDirectory = (await stat(path)).isDirectory();
    } catch {
        throw new RevealError('path-not-found', `${path} does not exist`);
    }
    try {
        const proc = Bun.spawn(revealCommand(path, isDirectory, platform), { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore' });
        proc.unref();
    } catch (e) {
        throw new RevealError('reveal-failed', e instanceof Error ? e.message : 'The file manager could not be started');
    }
};
