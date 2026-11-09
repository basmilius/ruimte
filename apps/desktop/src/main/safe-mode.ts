import type { DesktopIpc } from './ipc';

const SAFE_MODE_ARGUMENT = '--safe-mode';

/* The page starts without extensions and themes when its address has this (`apps/client/src/extensions/safe-mode.ts`). */
const SAFE_MODE_PARAM = 'safe-mode';

export function startsInSafeMode(argv: readonly string[]): boolean {
    return argv.includes(SAFE_MODE_ARGUMENT);
}

/* The address a window loads, marked while the app runs in safe mode, so every window of this start loads no extension. */
export function inSafeMode(url: string, safeMode: boolean): string {
    if (!safeMode) {
        return url;
    }

    const marked = new URL(url);
    marked.searchParams.set(SAFE_MODE_PARAM, '1');

    return marked.toString();
}

interface SafeModeOptions {
    /* The command line this start ran with, Electron's own path first. */
    argv: readonly string[];
    /* Quits and starts the app again with these arguments. */
    relaunch(args: string[]): void;
    /* The question a quit asks while work runs; a native dialog, so it works on a page an extension broke. */
    askBeforeQuit(): Promise<boolean>;
    /* Runs after the current call, so the reply reaches the page before the windows go. */
    later?(run: () => void): void;
}

/*
 * Help's Restart Without Extensions: a window has no address bar, and an extension that breaks the page
 * is removed from a start that loads none. The next ordinary start loads them again.
 */
export function installSafeMode(ipc: DesktopIpc, options: SafeModeOptions): void {
    const later = options.later ?? ((run: () => void) => void setTimeout(run, 0));

    ipc.handle('app:restart-safe-mode', async () => {
        if (!(await options.askBeforeQuit())) {
            return;
        }

        const args = [...options.argv.slice(1).filter((arg) => arg !== SAFE_MODE_ARGUMENT), SAFE_MODE_ARGUMENT];
        later(() => options.relaunch(args));
    });
}
