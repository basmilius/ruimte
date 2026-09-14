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

/* What the agents of this window add up to, as the shell needs it. Mirrors `apps/desktop/src/main.ts`. */
export interface AgentActivity {
    /* Agents in the middle of a turn. What the quit dialog names, and never an attached shell. */
    working: number;
    /* Nodes waiting to be looked at: the ones that need you plus the ones that finished out of sight. */
    attention: number;
}

/* The shell's API, present only inside the desktop app. Mirrors `apps/desktop/src/preload.ts`. */
export interface DesktopBridge {
    platform: string;
    /* What the shell is built on, for About and a bug report. Optional for the same reason
       `onBrowserContextMenu` is. */
    versions?: { electron: string; chrome: string; node: string };
    pickFolder(initialPath?: string): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    openGuestDevTools(webContentsId: number): void;
    /* A right-click inside a page: the shell says what the click landed on, the client draws the
       menu. Optional: a shell that is already running carries the preload it started with, so a
       method added since then is missing until it restarts. */
    onBrowserContextMenu?(listener: (params: BrowserContextParams) => void): () => void;
    /* The row that was picked, for the part of it the client cannot do itself. */
    browserContextAction?(action: BrowserContextAction): void;
    /* A guest page took the focus, which a press inside it never tells the page around it. Optional
       for the same reason `onBrowserContextMenu` is. */
    onGuestFocus?(listener: (webContentsId: number) => void): () => void;
    /* Where a file dragged in from the file manager lives, which a browser never tells a page.
       Optional for the same reason `onBrowserContextMenu` is; without it such a drag is refused. */
    pathForFile?(file: File): string | null;
    /* About and Settings in the macOS application menu. About names its pane; Settings names none
       (null), and neither does a section this client does not know, which open the settings where
       they were. Optional for the same reason `onBrowserContextMenu` is. */
    onOpenSettings?(listener: (section: string | null) => void): () => void;
    isFullscreen(): Promise<boolean>;
    onFullscreen(listener: (fullscreen: boolean) => void): () => void;
    /* The app's theme, which the shell needs for the native window controls, for the
       `prefers-color-scheme` every page it hosts asks for, and for the ground a page paints on
       before it has one. Optional for the same reason `onBrowserContextMenu` is. */
    setTheme?(theme: { resolved: 'light' | 'dark'; followsSystem: boolean; background: string }): void;
    /* Keeps the machine from sleeping while an agent works. The client decides when that is and says
       so; the shell holds the block and drops it on a reload or when the window goes. Optional for
       the same reason `onBrowserContextMenu` is; without it the setting is not offered. */
    setKeepAwake?(keep: boolean): void;
    /* How much of the work still wants a person. The client counts it (`state/attention.ts`): only
       it knows which node holds an agent and which holds a shell somebody left attached. The shell
       badges the dock with `attention` and asks before quitting on `working`. Optional for the same
       reason `onBrowserContextMenu` is; without it there is no badge and no question at quit. */
    setAgentActivity?(activity: AgentActivity): void;
    /* A native save dialog for bytes the client made (an exported drawing). Optional for the same
       reason `onBrowserContextMenu` is; without it the client falls back to a browser download. */
    saveFile?(suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null>;
    /* Updating, which only the shell can do. Optional for the same reason `onBrowserContextMenu`
       is: a shell that is already running carries the preload it started with. Without them the
       client shows no update button and About says where updates come from instead. */
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

/* True where the shell can hold the machine awake. A browser cannot, so the setting is not offered
   there rather than shown as a switch that promises something the page has no way to do. */
export const canKeepAwake = (): boolean => typeof desktop()?.setKeepAwake === 'function';

/* True when the window chrome leaves room for the traffic lights, which only macOS does. */
export const hasTrafficLights = (): boolean => desktop()?.platform === 'darwin';

/* The traffic lights end 64px in (12px from the edge, then three 12px buttons 8px apart, see the
   shell), and the first control starts 20px after that, so the lights read as their own group. */
export const TRAFFIC_LIGHTS_INSET_PX = 84;

/* True on macOS, in the desktop app and in a browser tab alike. Shortcuts differ there: Ctrl+B is
   readline's backward-char and tmux's prefix, while Cmd+B is free. */
export const isApplePlatform = (): boolean => {
    const bridge = desktop();
    if (bridge) {
        return bridge.platform === 'darwin';
    }
    if (typeof navigator === 'undefined') {
        return false;
    }
    const hints = (navigator as Navigator & { userAgentData?: { platform?: string } }).userAgentData;
    return applePlatformFrom(hints?.platform || navigator.platform);
};

/* Never the daemon's platform: the keyboard in question is the one in front of this page. */
export const applePlatformFrom = (platform: string | undefined): boolean => /mac|iphone|ipad/i.test(platform ?? '');

/* True when the window controls sit over the top right of the window, which Windows and Linux do. */
export const hasOverlayControls = (): boolean => {
    const bridge = desktop();
    return bridge !== null && bridge.platform !== 'darwin';
};
