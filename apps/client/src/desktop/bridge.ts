/*
 * What the shell forwards when a page asks for a context menu: Electron's own params, trimmed to
 * what a row needs, plus the guest that asked. The menu itself is drawn by the client, except over
 * an editable field: that click stays in the shell, which pops a native menu, so `isEditable` is
 * false in everything that arrives here.
 */
export interface BrowserContextParams {
    webContentsId: number;
    /* Where the click landed, in the window's coordinates: Chromium maps a guest's point into the embedder before the event leaves. */
    x: number;
    y: number;
    linkURL: string;
    linkText: string;
    srcURL: string;
    mediaType: string;
    isEditable: boolean;
    selectionText: string;
    editFlags: { canCut: boolean; canCopy: boolean; canPaste: boolean; canSelectAll: boolean };
    pageURL: string;
}

/* What only the shell can carry out on a guest page, once the client knows which row was picked. */
export type BrowserShellAction = 'copy' | 'copy-image' | 'save-image' | 'inspect' | 'open-external';

export interface BrowserContextAction {
    webContentsId: number;
    action: BrowserShellAction;
    payload?: { url?: string; x?: number; y?: number };
}

/* Where updating stands. Mirrors the `UpdateState` the shell keeps in `apps/desktop/src/main.ts`. */
export interface UpdateState {
    /* `unsupported` is a checkout, which has no feed; `current` means a check found nothing newer. */
    status: 'unsupported' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
    currentVersion: string;
    /* The version on the other side, once a check has seen one. */
    version?: string;
    percent?: number;
    error?: string | null;
}

/* The shell's API, present only inside the desktop app. Mirrors `apps/desktop/src/preload.ts`. */
export interface DesktopBridge {
    platform: string;
    pickFolder(initialPath?: string): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    openGuestDevTools(webContentsId: number): void;
    /* A right-click inside a page: the shell says what the click landed on, the client draws the
       menu. Optional: a shell that is already running carries the preload it started with, so a
       method added since then is missing until it restarts. */
    onBrowserContextMenu?(listener: (params: BrowserContextParams) => void): () => void;
    /* The row that was picked, for the part of it the client cannot do itself. */
    browserContextAction?(action: BrowserContextAction): void;
    /* Where a file dragged in from the file manager lives, which a browser never tells a page.
       Optional for the same reason `onBrowserContextMenu` is; without it such a drag is refused. */
    pathForFile?(file: File): string | null;
    isFullscreen(): Promise<boolean>;
    onFullscreen(listener: (fullscreen: boolean) => void): () => void;
    /* The app's theme, which the shell needs for the native window controls, for the
       `prefers-color-scheme` every page it hosts asks for, and for the ground a page paints on
       before it has one. Optional for the same reason `onBrowserContextMenu` is. */
    setTheme?(theme: { resolved: 'light' | 'dark'; followsSystem: boolean; background: string }): void;
    /* A native save dialog for bytes the client made (an exported drawing). Optional for the same
       reason `onBrowserContextMenu` is; without it the client falls back to a browser download. */
    saveFile?(suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null>;
    /* Updating, which only the shell can do. Optional for the same reason `onBrowserContextMenu`
       is: a shell that is already running carries the preload it started with. Without them the
       client shows no update button and the Updates pane says where updates come from instead. */
    updateState?(): Promise<UpdateState>;
    onUpdateState?(listener: (state: UpdateState) => void): () => void;
    /* Whether the shell downloads an update as soon as it sees one. The client owns the setting and
       sends it before the first check, so nothing downloads behind the back of someone who said no. */
    configureUpdates?(autoDownload: boolean): Promise<void>;
    checkForUpdate?(): Promise<void>;
    downloadUpdate?(): Promise<void>;
    installUpdate?(): void;
}

declare global {
    interface Window {
        ruimteDesktop?: DesktopBridge;
    }
}

export const desktop = (): DesktopBridge | null => (typeof window === 'undefined' ? null : (window.ruimteDesktop ?? null));

export const isDesktop = (): boolean => desktop() !== null;

/* True when the window chrome leaves room for the traffic lights, which only macOS does. */
export const hasTrafficLights = (): boolean => desktop()?.platform === 'darwin';

/* The traffic lights end 64px in (12px from the edge, then three 12px buttons 8px apart, see the
   shell), and the first control starts 20px after that, so the lights read as their own group. */
export const TRAFFIC_LIGHTS_INSET_PX = 84;

/* True on macOS, in the desktop app and in a browser tab alike. Chords differ there: Ctrl+B is
   readline's backward-char and tmux's prefix, while Cmd+B is free. */
export const isApplePlatform = (): boolean => {
    const bridge = desktop();
    if (bridge) {
        return bridge.platform === 'darwin';
    }
    return typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform);
};

/* True when the window controls sit over the top right of the window, which Windows and Linux do. */
export const hasOverlayControls = (): boolean => {
    const bridge = desktop();
    return bridge !== null && bridge.platform !== 'darwin';
};
