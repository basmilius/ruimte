import type { SessionLoginCode } from '@ruimte/pulsar';
import type { BrowserRouteBinding, BrowserRouteBlocked } from './browser.ts';
import type { DatabaseSecretsBridge, OpenPathRequest, SavePathRequest } from './database.ts';
import type { MachineModeBridge } from './machine.ts';
import type { MenuSpec } from './menu.ts';
import type { MicrophoneBridge } from './microphone.ts';
import type { KeepAwakeRequest, SystemIdleState } from './power.ts';
import type { BackgroundServiceState } from './service.ts';
import type { SpeechBridge } from './speech.ts';
import type { AgentActivity, ReleaseNotesState, UpdateState, UpdateTrack } from './update.ts';
import type { OpenAiLivePreferences } from './voice.ts';

/* A point on the screen, where the top left corner of a window that opens goes. */
export interface WindowPoint {
    x: number;
    y: number;
}

/*
 * Electron's context-menu params, trimmed to what a row needs, plus the guest that asked. A click on
 * an editable field stays in the shell for a native menu, so `isEditable` is false in all of these.
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
 * A file written to this computer piece by piece. An id answers only the window that began it, and a
 * save that is not ended leaves nothing under the chosen name, also when the window goes.
 */
export interface SaveFileStreamBridge {
    /* Asks where it goes; null when the person cancelled. */
    begin(suggestedName: string, mime: string): Promise<string | null>;
    /* At most 1 MiB per piece; a larger one ends the save. */
    write(id: string, bytes: Uint8Array): Promise<void>;
    /* Answers the path the file got. */
    end(id: string): Promise<string>;
    abort(id: string): Promise<void>;
}

/*
 * Signing in to the Pulsar address book. The answers are unknown because they crossed a process
 * boundary; `pulsar/desktop.ts` in the client parses each one.
 */
export interface PulsarBridge {
    addressBook(): Promise<string>;
    /* Opens a loopback listener for the login redirect; a second call gives up on the first. */
    listen(): Promise<{ redirectUri: string }>;
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
    /* Restarts the machine onto the updated build, ending what runs on it. */
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

/*
 * The shell's API, present only inside the desktop app, which `apps/desktop/src/preload.ts` builds
 * and checks against this type. A method added after the first release is optional: a running shell
 * carries the preload it started with, so a newer method is missing until it restarts.
 */
export interface DesktopBridge {
    // Remote projects and persisted owners require a host that guards guest-initiated navigation.
    bindBrowserRoute?(binding: BrowserRouteBinding): Promise<boolean>;
    onBrowserRouteBlocked?(listener: (event: BrowserRouteBlocked) => void): () => void;
    platform: string;
    /* For About and a bug report. */
    versions?: { electron: string; chrome: string; node: string };
    /* The region the operating system writes numbers and dates in; Chromium's own locale is the
       language of the app bundle. Read when the window opened, so a change lands on the next start. */
    systemLocale?: string;
    /* The languages the operating system asks for, best first, read at the same moment as the region. */
    systemLanguages?: string[];
    /* Where the machine this app started listens, since the shell serves the page on a scheme of its
       own. Absent under `bun dev`, where Vite's proxy makes the page's own origin the machine, and
       from a shell from before the scheme, whose page the machine served. */
    daemonUrl?: string;
    pickFolder(initialPath?: string): Promise<string | null>;
    openExternal(url: string): Promise<void>;
    /* Opens a pane of System Settings on macOS, only the ones the shell allows (`isSystemSettingsPane`). */
    openSystemSettings?(url: string): Promise<void>;
    openGuestDevTools(webContentsId: number): void;
    /* A png of a guest page, which is how an agent gets a picture of the page it drives. */
    capturePage?(webContentsId: number): Promise<Uint8Array | null>;
    /* A right-click inside a page. The shell says what the click landed on, the client draws the menu. */
    onBrowserContextMenu?(listener: (params: BrowserContextParams) => void): () => void;
    browserContextAction?(action: BrowserContextAction): void;
    /* A guest page took the focus, which a press inside it never tells the page around it. */
    onGuestFocus?(listener: (webContentsId: number) => void): () => void;
    /* Where a file dragged in from the file manager lives, which a browser never tells a page.
       Without it such a drag is refused. */
    pathForFile?(file: File): string | null;
    /* About and Settings in the macOS application menu. About names its pane; Settings names none
       (null), and neither does a section this client does not know. */
    onOpenSettings?(listener: (section: string | null) => void): () => void;
    /* The application menu, built from what has the focus (`shell/menu`). A click comes back as the
       command's id. Without them the shell keeps its own fixed menu. */
    setMenu?(spec: MenuSpec): void;
    onMenuCommand?(listener: (id: string) => void): () => void;
    /* Retained by the shell after its last window closes, for the native quit question. */
    setLanguage?(language: string): void;
    isFullscreen(): Promise<boolean>;
    onFullscreen(listener: (fullscreen: boolean) => void): () => void;
    /* For the native window controls, the `prefers-color-scheme` of every hosted page, and the ground
       a page paints on before it has one. */
    setTheme?(theme: { resolved: 'light' | 'dark'; followsSystem: boolean; background: string }): void;
    /* Tells the shell which project this window shows (`endpointKey`), or none (null). False when
       another window has it, which the shell brings to the front; this page then stays where it was. */
    claimWindow?(key: string | null): Promise<boolean>;
    /* Opens a window on a project, or raises the window that has it; null opens the start screen.
       A shell from before views ignores the view, and one from before points opens it where it likes. */
    openWindow?(key: string | null, view?: string, at?: WindowPoint): void;
    /* Another window asked this one to show a view of its project (`openWindow` with a view). */
    onShowView?(listener: (view: string) => void): () => void;
    /* Hands this window's project to a new window, which has it before this one lets go. True once it
       did, and then this page goes to the start screen. */
    moveToNewWindow?(at?: WindowPoint): Promise<boolean>;
    /* What this page keeps of itself across a quit (its tabs); the shell hands it back in the address
       of the window it opens again. Null keeps nothing. */
    setWindowState?(state: string | null): void;
    /* Closes this window when another one is open, and answers whether it did; the last window stays. */
    closeWindowIfOthers?(): Promise<boolean>;
    /* The projects this window keeps as tabs, which no other window may show. Answers the ones it
       has: a project another window keeps stays there. */
    holdTabs?(keys: string[]): Promise<string[]>;
    /* A tab pressed in this window left it (`start`), as a window of its own that follows the pointer,
       or the window itself when `whole`; `end` when the press lets go, where the shell hands the
       project to a window whose strip is under the pointer. `grab` is where in the window the pointer
       holds it, and `tabWidth` how wide the tab is, so the pointer holds a torn off window by its tab. */
    tabDrag?(phase: 'start' | 'end', key: string, grab: WindowPoint, whole: boolean, tabWidth?: number): Promise<boolean>;
    /* Something asked for a project this window keeps as a tab, and the window came to the front for it. */
    onShowProject?(listener: (key: string) => void): () => void;
    /* A tab dragged from another window came over this one, which keeps its project now and shows
       it. `x` is where along the strip it came in, null for a tab let go over the body of the window. */
    onTakeProject?(listener: (key: string, x: number | null) => void): () => void;
    /* The tab dragged in went out of this window's strip again while still held, and is no longer this window's. */
    onReleaseProject?(listener: (key: string) => void): () => void;
    /* The tab dragged in moved along this window's strip, to `x` in the page's coordinates. */
    onTabDragOver?(listener: (key: string, x: number) => void): () => void;
    /* Where this page draws its tab strip, which a tab dragged out of another window drops into; null without one. */
    setTabStrip?(rect: { x: number; y: number; width: number; height: number } | null): void;
    /* Superseded by `requestKeepAwake`, and still what a shell from before that one understands. The
       shell drops the block on a reload or when the window goes. */
    setKeepAwake?(keep: boolean): void;
    /* What the client wants held, or null for nothing. The shell weighs it against the power source
       it sees, live, and ignores it off macOS. */
    requestKeepAwake?(request: KeepAwakeRequest | null): void;
    /* Whether the person used this computer in the last `thresholdSeconds`, in any app, or locked it. */
    idleState?(thresholdSeconds: number): Promise<SystemIdleState>;
    /* Counted by the client (`state/attention.ts`), since only it knows which node holds an agent. The
       shell badges the dock with `attention` and asks before quitting on `working`. */
    setAgentActivity?(activity: AgentActivity): void;
    /* A native save dialog for bytes the client made. Without it the client falls back to a download. */
    saveFile?(suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null>;
    /* The same dialog for a file too large to hold in the page, written as it arrives. Without it the
       client saves only what fits in memory. */
    saveFileStream?: SaveFileStreamBridge;
    /* Opens a temporary image copy in the system viewer; older shells fall back to a download. */
    openImage?(suggestedName: string, bytes: Uint8Array, mime: string): Promise<void>;
    /* A native save dialog that writes nothing itself. Without it a database offers no export. */
    chooseSavePath?(request: SavePathRequest): Promise<string | null>;
    /* A native open dialog that reads nothing. Without it a database offers no import and no browse button. */
    chooseOpenPath?(request: OpenPathRequest): Promise<string | null>;
    /* Puts files on the clipboard the way the file manager pastes them, with the paths as text beside
       them. False when a path is not absolute or no longer exists. Absent on a platform the shell has
       no format for. */
    copyFiles?(paths: string[]): Promise<boolean>;
    /* Shows a file in Quick Look over this window, or moves an open Quick Look on to it. False when
       the shell refused it: only a file inside the folder of the project this window shows, on the
       machine this app runs. Absent off macOS and without a machine of its own. */
    previewFile?(path: string): Promise<boolean>;
    closeFilePreview?(): void;
    /* Without the update methods the client shows no update button and About says where updates come from. */
    updateState?(): Promise<UpdateState>;
    onUpdateState?(listener: (state: UpdateState) => void): () => void;
    /* Sent before the first check, so nothing downloads behind the back of someone who said no. */
    configureUpdates?(autoDownload: boolean): Promise<void>;
    /* Also sent before the first check, since a build otherwise follows only what its own version is. */
    configureUpdateTrack?(track: UpdateTrack): Promise<void>;
    checkForUpdate?(): Promise<void>;
    downloadUpdate?(): Promise<void>;
    /* `confirmed` skips the shell's question about what a quit ends, for a person who already answered
       it on another client. A shell from before ignores it and asks on this computer. */
    installUpdate?(confirmed?: boolean): void;
    /* From the shell's copy on disk; `refresh` asks GitHub first. */
    releaseNotes?(refresh?: boolean): Promise<ReleaseNotesState>;
    /* The secret in the home of the daemon this app started, which the local row presents to get in,
       since a loopback address proves nothing. Null while the daemon has not written it. A window
       opens while the machine still comes up, and this answers only once it proved itself. */
    localSecret?(): Promise<string | null>;
    /* How long this app took from its start to now, in milliseconds, for the machine's usage counts.
       Only the first caller after a start gets it; every later one, another window too, gets null. */
    takeStartupMs?(): Promise<number | null>;
    /* One more of a name of `USAGE_DESKTOP_COUNTERS` (`@ruimte/pulsar`) for the app's own usage counts; the shell drops any other
       name, and counts nothing at all in a build that does not report or while the machine's switch is off. */
    countUsage?(name: string): void;
    /* macOS owns the application-level microphone grant; the shell asks while the renderer only
       receives the result. Other platforms let Chromium handle the same request. */
    requestMicrophoneAccess?(): Promise<boolean>;
    /* The API key stays in the shell; the page can replace it and learn whether one exists, but it
       can never read the value back. */
    openAi?: OpenAiBridge;
    /* Kept by the shell and never in a project's files. Without it a password lasts as long as the page. */
    databaseSecrets?: DatabaseSecretsBridge;
    /* Without it dictation is not offered. */
    speech?: SpeechBridge;
    /* Who listens to the microphone, across windows. Without it each window only keeps its own listeners apart. */
    microphone?: MicrophoneBridge;
    /* Without it This machine offers no switch, which is also what a browser gets. */
    backgroundService?: BackgroundServiceBridge;
    /* Without it the account section says signing in works in the desktop app. */
    pulsar?: PulsarBridge;
    /* Absent from a shell from before the mode, which always ran a machine. */
    machine?: MachineModeBridge;
}
