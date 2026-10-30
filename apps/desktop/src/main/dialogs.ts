import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { allFilesLabel, openDialogPlan, parseOpenPathRequest, parseSavePathRequest } from '../database-bridge';
import { copyablePaths, copyFilesOnWindows, fileClipboard, osClipboardFormat } from '../file-clipboard';
import { openImageCopy } from '../open-image';
import { SaveStreams } from '../save-streams';
import { isSystemSettingsPane, isWebLink } from '../web-guards';
import { electron } from './electron';
import type { AppIpc } from './ipc';

const { app, clipboard, ClipboardItem, dialog, shell } = electron;

function savedPath(result: Electron.SaveDialogReturnValue): string | null {
    return result.canceled || !result.filePath ? null : result.filePath;
}

function openedPath(result: Electron.OpenDialogReturnValue): string | null {
    return result.canceled ? null : (result.filePaths[0] ?? null);
}

/* The save dialog for a file the page names, filtered to its extension; null when the person cancels. */
async function askSavePath(window: Electron.BrowserWindow, suggestedName: string, mime: string): Promise<string | null> {
    const extension = suggestedName.split('.').pop() ?? '';

    return savedPath(
        await dialog.showSaveDialog(window, {
            defaultPath: suggestedName,
            ...(extension ? { filters: [{ name: mime, extensions: [extension] }] } : {})
        })
    );
}

/* The native dialogs, the system's own apps and the clipboard, for files a page names. */
export function installDialogs(ipc: AppIpc, language: () => string | undefined): void {
    ipc.handle('dialog:pick-folder', async (event, initialPath?: string) => {
        const window = ipc.senderWindow(event);
        if (!window) {
            return null;
        }
        return openedPath(
            await dialog.showOpenDialog(window, {
                properties: ['openDirectory', 'createDirectory'],
                ...(initialPath ? { defaultPath: initialPath } : {})
            })
        );
    });

    ipc.handle('dialog:save-file', async (event, suggestedName: string, bytes: Uint8Array, mime: string) => {
        const window = ipc.senderWindow(event);
        const path = window ? await askSavePath(window, suggestedName, mime) : null;
        if (path === null) {
            return null;
        }
        await writeFile(path, Buffer.from(bytes));
        return path;
    });

    installSaveStreams(ipc);

    const openedImagesFolder = join(app.getPath('temp'), `ruimte-images-${process.pid}-${randomBytes(8).toString('hex')}`);
    app.on('will-quit', () => void rm(openedImagesFolder, { recursive: true, force: true }).catch(() => undefined));
    ipc.handle('image:open', async (_event, suggestedName: string, bytes: Uint8Array, mime: string) => {
        await openImageCopy(openedImagesFolder, suggestedName, bytes, mime, (path) => shell.openPath(path));
    });

    /* Where a database export goes. Only the path comes back: the machine writes the file, and only for a page on this computer. */
    ipc.handle('dialog:choose-save-path', async (event, request: unknown) => {
        const { suggestedName, extension } = parseSavePathRequest(request);
        const window = ipc.senderWindow(event);
        if (!window) {
            return null;
        }
        return savedPath(
            await dialog.showSaveDialog(window, {
                defaultPath: suggestedName,
                filters: [
                    { name: extension.toUpperCase(), extensions: [extension] },
                    { name: allFilesLabel(language()), extensions: ['*'] }
                ]
            })
        );
    });

    /* A file to import, a SQLite database or an SSH key. Only the path comes back; nothing is read here. */
    ipc.handle('dialog:choose-open-path', async (event, request: unknown) => {
        const plan = openDialogPlan(parseOpenPathRequest(request), app.getPath('home'), allFilesLabel(language()));
        const window = ipc.senderWindow(event);
        if (!window) {
            return null;
        }
        return openedPath(
            await dialog.showOpenDialog(window, {
                properties: plan.showHiddenFiles ? ['openFile', 'showHiddenFiles'] : ['openFile'],
                filters: plan.filters,
                ...(plan.defaultPath === undefined ? {} : { defaultPath: plan.defaultPath })
            })
        );
    });

    ipc.handle('shell:open-external', async (_event, url: string) => {
        if (isWebLink(url)) {
            await shell.openExternal(url);
        }
    });

    ipc.handle('shell:open-system-settings', async (_event, url: string) => {
        if (process.platform === 'darwin' && isSystemSettingsPane(url)) {
            await shell.openExternal(url);
        }
    });

    // One path that is relative or gone refuses the whole copy.
    ipc.handle('clipboard:copy-files', async (_event, requested: unknown) => {
        const paths = copyablePaths(requested);
        if (process.platform === 'win32') {
            return paths !== null && paths.every((path) => existsSync(path)) && copyFilesOnWindows(paths);
        }
        const contents = paths === null ? null : fileClipboard(process.platform, paths);
        if (paths === null || contents === null || !paths.every((path) => existsSync(path))) {
            return false;
        }
        const formats = Object.entries(contents.formats).map(([format, value]) => [osClipboardFormat(format), new Blob([value])] as const);
        await clipboard.write([new ClipboardItem({ 'text/plain': contents.text, ...Object.fromEntries(formats) })]);
        return true;
    });
}

/* A machine's file saved as its pieces arrive, owned by the page that asked, which loses its saves when it goes. */
function installSaveStreams(ipc: AppIpc): void {
    const streams = new SaveStreams();
    const watched = new Set<number>();

    ipc.handle('save-stream:begin', async (event, suggestedName: string, mime: string) => {
        const window = ipc.senderWindow(event);
        const path = window ? await askSavePath(window, suggestedName, mime) : null;
        if (path === null) {
            return null;
        }
        const contents = event.sender;
        if (!watched.has(contents.id)) {
            watched.add(contents.id);
            const owner = contents.id;
            // A reload drops the ids the page held, so what it began is abandoned like a closed window's.
            contents.on('did-navigate', () => void streams.abortOwner(owner));
            contents.once('destroyed', () => {
                watched.delete(owner);
                void streams.abortOwner(owner);
            });
        }
        return streams.begin(contents.id, path);
    });
    ipc.handle('save-stream:write', (event, id: string, bytes: Uint8Array) => streams.write(event.sender.id, id, bytes));
    ipc.handle('save-stream:end', (event, id: string) => streams.end(event.sender.id, id));
    ipc.handle('save-stream:abort', (event, id: string) => streams.abort(event.sender.id, id));
}
