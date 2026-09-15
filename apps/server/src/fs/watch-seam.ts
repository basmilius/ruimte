import { watch } from 'node:fs';

/* The part of an `fs.watch` handle the watchers use. */
export interface DirectoryWatcher {
    on(event: 'error', listener: (error: Error) => void): unknown;
    close(): void;
}

export type WatchDirectory = (path: string, options: { recursive: boolean }, listener: (event: string, filename: string | null) => void) => DirectoryWatcher;

/* Runs `callback` after `ms` and answers with the function that cancels it. */
export type Schedule = (callback: () => unknown, ms: number) => () => void;

/* What every watcher reaches the file system and the clock through, so a test can hand it fakes that it drives by hand. */
export interface WatchSeams {
    watch: WatchDirectory;
    schedule: Schedule;
}

export const SYSTEM_WATCH: WatchSeams = {
    watch: (path, options, listener) => watch(path, options, listener),
    schedule: (callback, ms) => {
        const timer = setTimeout(callback, ms);
        return () => clearTimeout(timer);
    }
};
