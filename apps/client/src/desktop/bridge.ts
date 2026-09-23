import type {
    AgentActivity,
    BackgroundServiceState,
    MenuSpec,
    OpenAiLivePreferences,
    ReleaseNotesState,
    SpeechBridge,
    UpdateState
} from '@ruimte/desktop-bridge';
import type { SessionLoginCode } from '@ruimte/pulsar';

/* The shapes the preload and the page both hold, passed on so the client reads the whole bridge here. */
export type {
    AgentActivity,
    BackgroundServiceState,
    DaemonOwner,
    OpenAiLivePreferences,
    PendingRestart,
    Release,
    ReleaseNotesState,
    ServiceSupport,
    UpdateState
} from '@ruimte/desktop-bridge';

/*
 * What the shell forwards when a page asks for a context menu. Electron's own params, trimmed to
 * what a row needs, plus the guest that asked. The menu itself is drawn by the client, except over
 * an editable field, where that click stays in the shell and pops a native menu, so `isEditable`
 * is false in everything that arrives here.
 */
export interface BrowserContextParams {
    webContentsId: number;
    /* An HTML file's preview, which has no history and only reads. Missing from a shell older than
       the preview's menu. */
    guest?: 'browser' | 'preview';
    /* Where the click landed, in the window's coordinates. Chromium maps a guest's point into the embedder before the event leaves. */
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
export type BrowserShellAction = 'copy' | 'select-all' | 'copy-image' | 'save-image' | 'inspect' | 'open-external';

export interface BrowserContextAction {
    webContentsId: number;
    action: BrowserShellAction;
    payload?: { url?: string; x?: number; y?: number };
}

/*
 * Signing in to the Pulsar address book, the part only the shell can do. Mirrors `pulsar` in
 * `apps/desktop/src/preload.ts`. The answers are unknown on purpose. They crossed a process boundary,
 * and `pulsar/desktop.ts` parses each one.
 */
export interface PulsarBridge {
    /* The address book the shell signs in to, which the page uses for the machine list and statements. */
    addressBook(): Promise<string>;
    /* Opens a loopback listener for the login redirect; a second call gives up on the first. */
    listen(): Promise<{ redirectUri: string }>;
    /* The redirect, once the browser comes back with it. */
    callback(): Promise<unknown>;
    cancel(): Promise<void>;
    /* Trades a login code for a session bound to the shell's own key; the shell keeps the refresh token and answers with the rest. */
    exchange(payload: SessionLoginCode): Promise<unknown>;
    refresh(): Promise<unknown>;
    restore(): Promise<unknown>;
    signOut(): Promise<void>;
}

/* The switch and the stop button of This machine, which only the shell can carry out. */
export interface BackgroundServiceBridge {
    state(): Promise<BackgroundServiceState>;
    onState(listener: (state: BackgroundServiceState) => void): () => void;
    setKeepRunning(keepRunning: boolean): Promise<BackgroundServiceState>;
    /* Runs `loginctl enable-linger`, which is a person's decision and never taken on their behalf. */
    enableLinger(): Promise<BackgroundServiceState>;
    /* Restarts the machine onto the updated build, ending what runs on it. Optional: an older shell has neither. */
    restartNow?(): Promise<BackgroundServiceState>;
    /* Leaves the older build running until nothing runs on it. */
    restartWhenIdle?(): Promise<BackgroundServiceState>;
    /* Stops the service and quits the app; the next start of the app brings the machine back. */
    stopMachine(): void;
}

export interface OpenAiCredentialStatus {
    configured: boolean;
    persistent: boolean;
}

export interface OpenAiBridge {
    credentialStatus(): Promise<OpenAiCredentialStatus>;
    saveApiKey(apiKey: string): Promise<OpenAiCredentialStatus>;
    clearApiKey(): Promise<OpenAiCredentialStatus>;
    createLiveSession(sdp: string, preferences: OpenAiLivePreferences): Promise<{ session: { id: string }; transport: { type: 'webrtc'; sdp: string } }>;
}

/* The shell's API, present only inside the desktop app. Mirrors `apps/desktop/src/preload.ts`. */
export interface DesktopBridge {
    platform: string;
    /* What the shell is built on, for About and a bug report. Optional for the same reason
       `onBrowserContextMenu` is. */
    versions?: { electron: string; chrome: string; node: string };
    /* The region the operating system writes numbers and dates in, which Chromium's own locale is
       not. That one is the language of the app bundle, and the bundle names one language.
       Read once, when the window opened, so a region changed since then lands on the next start. */
    systemLocale?: string;
    /* The languages the operating system asks for, best first, read the same way and at the same
       moment as the region. */
    systemLanguages?: string[];
    pickFolder(initialPath?: string): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    openGuestDevTools(webContentsId: number): void;
    /* A png of a guest page, which is how an agent gets a picture of the page it drives. Optional
       for the same reason `onBrowserContextMenu` is. */
    capturePage?(webContentsId: number): Promise<Uint8Array | null>;
    /* A right-click inside a page. The shell says what the click landed on, the client draws the
       menu. Optional, because a shell that is already running carries the preload it started with,
       so a method added since then is missing until it restarts. */
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
    /* The application menu, built from what has the focus (`shell/menu`). A click comes back as the
       command's id. Optional for the same reason `onBrowserContextMenu` is; without them the shell
       keeps its own fixed menu. */
    setMenu?(spec: MenuSpec): void;
    onMenuCommand?(listener: (id: string) => void): () => void;
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
    /* How much of the work still wants a person. The client counts it (`state/attention.ts`). Only
       it knows which node holds an agent and which holds a shell somebody left attached. The shell
       badges the dock with `attention` and asks before quitting on `working`. Optional for the same
       reason `onBrowserContextMenu` is; without it there is no badge and no question at quit. */
    setAgentActivity?(activity: AgentActivity): void;
    /* A native save dialog for bytes the client made (an exported drawing). Optional for the same
       reason `onBrowserContextMenu` is; without it the client falls back to a browser download. */
    saveFile?(suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null>;
    /* Updating, which only the shell can do. Optional for the same reason `onBrowserContextMenu`
       is. A shell that is already running carries the preload it started with. Without them the
       client shows no update button and About says where updates come from instead. */
    updateState?(): Promise<UpdateState>;
    onUpdateState?(listener: (state: UpdateState) => void): () => void;
    /* Whether the shell downloads an update as soon as it sees one. The client owns the setting and
       sends it before the first check, so nothing downloads behind the back of someone who said no. */
    configureUpdates?(autoDownload: boolean): Promise<void>;
    checkForUpdate?(): Promise<void>;
    downloadUpdate?(): Promise<void>;
    installUpdate?(): void;
    /* The notes of the last releases, from the shell's copy on disk. `refresh` asks GitHub first.
       Optional for the same reason `onBrowserContextMenu` is; without it About offers no notes. */
    releaseNotes?(refresh?: boolean): Promise<ReleaseNotesState>;
    /* The secret in the home of the daemon this app started, which the local row presents instead of
       pairing. A loopback address is no proof of anything. Null while the daemon has not written it.
       Optional for the same reason `onBrowserContextMenu` is; without it the local row has to pair. */
    localSecret?(): Promise<string | null>;
    /* macOS owns the application-level microphone grant; the shell asks while the renderer only
       receives the result. Other platforms let Chromium handle the same request. */
    requestMicrophoneAccess?(): Promise<boolean>;
    /* The API key stays in the shell; the page can replace it and learn whether one exists, but it
       can never read the value back. Optional until the running shell has restarted onto this API. */
    openAi?: OpenAiBridge;
    /* Speech to text in a helper beside the app, on this machine. Optional for the same reason
       `onBrowserContextMenu` is; without it dictation is not offered. */
    speech?: SpeechBridge;
    /* The background service. Optional for the same reason `onBrowserContextMenu` is; without it
       This machine offers no switch, which is also what a browser and the web client get. */
    backgroundService?: BackgroundServiceBridge;
    /* Signing in to an account. Optional for the same reason `onBrowserContextMenu` is; without it
       the account section says signing in works in the desktop app, which is also what a browser gets. */
    pulsar?: PulsarBridge;
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

/* True only in the desktop app on macOS, where a two-finger swipe goes back and forward in a page.
   Elsewhere a mouse's side buttons do the same thing, and they work on every platform. */
export const canSwipeBetweenPages = (): boolean => desktop()?.platform === 'darwin';

/* True when the window chrome leaves room for the traffic lights, which only macOS does. */
export const hasTrafficLights = (): boolean => desktop()?.platform === 'darwin';

/* The traffic lights end 64px in (12px from the edge, then three 12px buttons 8px apart, see the
   shell), and the first control starts 20px after that, so the lights read as their own group. */
export const TRAFFIC_LIGHTS_INSET_PX = 84;

/* True on macOS, in the desktop app and in a browser tab alike. Shortcuts differ there. Ctrl+B is
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

/* Never the daemon's platform. The keyboard in question is the one in front of this page. */
export const applePlatformFrom = (platform: string | undefined): boolean => /mac|iphone|ipad/i.test(platform ?? '');

/* True when the window controls sit over the top right of the window, which Windows and Linux do. */
export const hasOverlayControls = (): boolean => {
    const bridge = desktop();
    return bridge !== null && bridge.platform !== 'darwin';
};
