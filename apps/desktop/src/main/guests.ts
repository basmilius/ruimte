import { createGestureGate, type AppIpc } from '@adecore/shell';
import { editFrameOf, runGuestEdit } from '../guest-edit';
import { contextMenuPayload, editableMenuTemplate, PREVIEW_ACTIONS, type BrowserContextAction, type GuestKind } from '../guest-menu';
import { BROWSER_PARTITION, isExternalLink, PREVIEW_PARTITION } from '../web-guards';
import { electron } from './electron';

const { BrowserWindow, Menu, session, shell, webContents } = electron;

const LOCAL_SCHEMES = ['file:', 'data:', 'blob:', 'about:'];

export interface GuestsOptions {
    /* The app window a guest page sits in, or null for a guest of no window of ours. */
    windowOf(contents: Electron.WebContents): Electron.BrowserWindow | null;
}

export interface Guests {
    contextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams, guest: GuestKind): void;
}

function isGuestOf(contents: Electron.WebContents, partition: string): boolean {
    return contents.getType() === 'webview' && contents.session === session.fromPartition(partition);
}

export function isBrowserGuest(contents: Electron.WebContents): boolean {
    return isGuestOf(contents, BROWSER_PARTITION);
}

export function isPreviewGuest(contents: Electron.WebContents): boolean {
    return isGuestOf(contents, PREVIEW_PARTITION);
}

/* A previewed file may load adjacent assets, but cannot use its scripts to reach a server or, without a press of the person, the system browser. */
export function sealPreviewSession(): void {
    const preview = session.fromPartition(PREVIEW_PARTITION);
    preview.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !LOCAL_SCHEMES.some((scheme) => details.url.startsWith(scheme)) }));
    preview.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

/* Network links a person clicks leave the sealed preview instead of failing silently inside it. */
export function routePreviewLinks(contents: Electron.WebContents): void {
    const gesture = createGestureGate();
    contents.on('input-event', (_event, input) => gesture.saw(input.type));
    contents.on('will-navigate', (event) => {
        if (isExternalLink(event.url)) {
            event.preventDefault();
            if (gesture.consume()) {
                void shell.openExternal(event.url);
            }
        }
    });
    contents.setWindowOpenHandler(({ url }) => {
        if (isExternalLink(url) && gesture.consume()) {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });
}

/* The pages of browser and preview nodes: their context menu, their inspector and a picture of them. */
export function installGuests(ipc: AppIpc, options: GuestsOptions): Guests {
    const devtoolsWindows = new Map<number, Electron.BrowserWindow>();
    // The frame each guest's last right-click landed in, so copy and select all act where the person pointed.
    const menuFrames = new WeakMap<Electron.WebContents, Electron.WebFrameMain>();

    /* Opens the inspector for a guest page, on the element under `at` when a point comes with it. */
    const devTools = (id: number, at?: { x: number; y: number }): void => {
        const guest = webContents.fromId(id);
        if (!guest) {
            return;
        }
        const existing = devtoolsWindows.get(id);
        if (existing && !existing.isDestroyed()) {
            existing.focus();
            if (at) {
                guest.inspectElement(at.x, at.y);
            }
            return;
        }
        // A window of our own, kept above everything, so the inspector floats over a fullscreen app.
        const window = new BrowserWindow({ width: 960, height: 640, title: 'Inspector', show: false, backgroundColor: '#1b1b1f' });
        window.setAlwaysOnTop(true, 'floating');
        window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
        guest.setDevToolsWebContents(window.webContents);
        if (at) {
            guest.inspectElement(at.x, at.y);
        } else {
            guest.openDevTools({ mode: 'detach' });
        }
        window.once('ready-to-show', () => window.show());
        window.on('closed', () => {
            devtoolsWindows.delete(id);
            if (!guest.isDestroyed()) {
                guest.closeDevTools();
            }
        });
        guest.once('destroyed', () => {
            if (!window.isDestroyed()) {
                window.close();
            }
        });
        devtoolsWindows.set(id, window);
    };

    const editableMenu = (contents: Electron.WebContents, params: Electron.ContextMenuParams, inspectable: boolean): void => {
        const template = editableMenuTemplate(params, process.platform, {
            replaceMisspelling: (word) => contents.replaceMisspelling(word),
            lookUp: () => contents.showDefinitionForSelection(),
            openExternal: (url) => void shell.openExternal(url),
            ...(inspectable ? { inspect: () => devTools(contents.id, { x: params.x, y: params.y }) } : {})
        });
        /*
         * The frame is what makes macOS append AutoFill, Writing Tools and Services; without it (navigated
         * away or dead) the menu still opens, without those rows. AutoFill reaches Apple's Passwords app only.
         */
        Menu.buildFromTemplate(template).popup({ window: options.windowOf(contents) ?? undefined, ...(params.frame ? { frame: params.frame } : {}) });
    };

    // What the renderer cannot reach itself. Editing rows never get here: an editable field's menu stays native.
    ipc.on('browser:context-action', (_event, request: BrowserContextAction) => {
        const contents = webContents.fromId(request.webContentsId);
        if (!contents || contents.isDestroyed()) {
            return;
        }
        if (!isBrowserGuest(contents) && !(isPreviewGuest(contents) && PREVIEW_ACTIONS.has(request.action))) {
            return;
        }
        const payload = request.payload ?? {};
        switch (request.action) {
            case 'copy':
            case 'select-all':
                runGuestEdit(editFrameOf(menuFrames.get(contents), contents.mainFrame), request.action);
                return;
            case 'copy-image':
                contents.copyImageAt(payload.x ?? 0, payload.y ?? 0);
                return;
            case 'save-image':
                // Nothing here handles `will-download`, so Electron asks where to put the file itself.
                if (payload.url) {
                    contents.downloadURL(payload.url);
                }
                return;
            case 'inspect':
                devTools(contents.id, { x: payload.x ?? 0, y: payload.y ?? 0 });
                return;
            case 'open-external':
                if (payload.url && /^https?:\/\//.test(payload.url)) {
                    void shell.openExternal(payload.url);
                }
                return;
        }
    });

    ipc.on('devtools:guest', (_event, id: number) => devTools(id));

    // For an agent that asked what the page it drives looks like. A guest's own preload has none of this.
    ipc.handle('browser:capture', async (_event, id: number) => {
        const guest = webContents.fromId(id);

        return guest ? (await guest.capturePage()).toPNG() : null;
    });

    return {
        /*
         * Electron ships no menu for web content and a native one reads as another program's, so the client
         * draws it. An editable field stays native, since what the platform adds there is worth more.
         */
        contextMenu: (contents, params, guest) => {
            if (params.isEditable) {
                editableMenu(contents, params, guest === 'browser');
                return;
            }
            if (params.frame) {
                menuFrames.set(contents, params.frame);
            } else {
                menuFrames.delete(contents);
            }
            // A guest of no window of ours gets none.
            options.windowOf(contents)?.webContents.send('browser:context-menu', contextMenuPayload(contents.id, guest, params));
        }
    };
}
