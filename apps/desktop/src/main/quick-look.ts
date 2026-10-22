import { readFile, realpath, stat } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { quickLookPath, type QuickLookFiles } from '../quick-look';
import type { AppIpc } from './ipc';

function diskFiles(ruimteHome: string): QuickLookFiles {
    return {
        registry: () => readFile(join(ruimteHome, 'projects.json'), 'utf8').catch(() => null),
        realpath: (path) => realpath(path).catch(() => null),
        isFile: (path) =>
            stat(path)
                .then((entry) => entry.isFile())
                .catch(() => false)
    };
}

/* Quick Look on a file of the project a window shows, for a shell on macOS with a machine of its own. */
export function installQuickLook(ipc: AppIpc, options: { ruimteHome: string; keyOf: (window: Electron.BrowserWindow) => string | null }): void {
    const files = diskFiles(options.ruimteHome);
    // Stepping through files asks again before a check is done, so only the last ask of a window opens anything.
    const asks = new WeakMap<Electron.BrowserWindow, number>();

    ipc.handle('quick-look:show', async (event, requested: unknown) => {
        const window = ipc.senderWindow(event);
        if (window === null) {
            return false;
        }
        const ask = (asks.get(window) ?? 0) + 1;
        asks.set(window, ask);
        const path = await quickLookPath(options.keyOf(window), requested, files);
        if (path === null || window.isDestroyed() || asks.get(window) !== ask) {
            return false;
        }
        window.previewFile(path, basename(path));
        return true;
    });

    ipc.on('quick-look:close', (event) => {
        const window = ipc.senderWindow(event);
        if (window !== null) {
            asks.set(window, (asks.get(window) ?? 0) + 1);
            window.closeFilePreview();
        }
    });
}
