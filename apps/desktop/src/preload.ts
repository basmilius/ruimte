import { ipcSubscriber } from '@adecore/shell/bridge';
import type {
    BackgroundServiceState,
    BrowserContextAction,
    BrowserContextParams,
    BrowserRouteBinding,
    BrowserRouteBlocked,
    DesktopBridge,
    KeepAwakeRequest,
    SystemIdleState,
    MenuSpec,
    OpenAiBridge,
    OpenAiCredentialStatus,
    OpenAiLivePreferences,
    MachineStopPreview,
    OpenPathRequest,
    ReleaseNotesState,
    SavePathRequest,
    SpeechEvent,
    SpeechState,
    UpdateState,
    UpdateTrack
} from '@ruimte/desktop-bridge';
import { modeFromArgv } from './machine-argument';

// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { contextBridge, ipcRenderer, webUtils } = require('electron') as typeof import('electron');

/* Where the main process puts the system's region and languages on the command line of this renderer. */
const LOCALE_ARGUMENT = '--ruimte-system-locale=';
const LANGUAGES_ARGUMENT = '--ruimte-system-languages=';
const DAEMON_URL_ARGUMENT = '--ruimte-daemon-url=';

type LiveSession = Awaited<ReturnType<OpenAiBridge['createLiveSession']>>;

function argument(prefix: string): string | undefined {
    return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || undefined;
}

const subscribe = ipcSubscriber(ipcRenderer);
const machineMode = modeFromArgv(process.argv);

/* The local secret and the service switch belong to a machine this app runs; without one they are not even offered. */
const localMachineBridge = {
    localSecret: (): Promise<string | null> => ipcRenderer.invoke('daemon:local-secret'),
    takeStartupMs: (): Promise<number | null> => ipcRenderer.invoke('usage:startup'),
    countUsage: (name: string): void => ipcRenderer.send('usage:count', name),
    backgroundService: {
        state: (): Promise<BackgroundServiceState> => ipcRenderer.invoke('service:state'),
        onState: subscribe<[state: BackgroundServiceState]>('service:state'),
        setKeepRunning: (keepRunning: boolean): Promise<BackgroundServiceState> => ipcRenderer.invoke('service:set-keep-running', keepRunning),
        enableLinger: (): Promise<BackgroundServiceState> => ipcRenderer.invoke('service:enable-linger'),
        restartNow: (): Promise<BackgroundServiceState> => ipcRenderer.invoke('service:restart-now'),
        restartWhenIdle: (): Promise<BackgroundServiceState> => ipcRenderer.invoke('service:restart-when-idle'),
        stopMachine: (): void => ipcRenderer.send('service:stop-machine')
    }
} satisfies Pick<DesktopBridge, 'localSecret' | 'takeStartupMs' | 'countUsage' | 'backgroundService'>;

/* Quick Look reads the folder a project has on this disk, so only a shell with a machine of its own offers it. */
const quickLookBridge = {
    previewFile: (path: string): Promise<boolean> => ipcRenderer.invoke('quick-look:show', path),
    closeFilePreview: (): void => ipcRenderer.send('quick-look:close')
} satisfies Pick<DesktopBridge, 'previewFile' | 'closeFilePreview'>;

/* What the client may ask the shell for, checked against the type the client reads it through. */
const bridge = {
    platform: process.platform,
    bindBrowserRoute: (binding: BrowserRouteBinding): Promise<boolean> => ipcRenderer.invoke('browser:bind-route', binding),
    onBrowserRouteBlocked: subscribe<[event: BrowserRouteBlocked]>('browser:route-blocked'),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    /* Handed down as an argument rather than fetched, because `app` is the main process alone and
       the client needs both before it draws its first word or its first number. */
    systemLocale: argument(LOCALE_ARGUMENT),
    systemLanguages: argument(LANGUAGES_ARGUMENT)?.split(','),
    daemonUrl: argument(DAEMON_URL_ARGUMENT),
    pickFolder: (initialPath?: string): Promise<string | null> => ipcRenderer.invoke('dialog:pick-folder', initialPath),
    openExternal: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-external', url),
    openSystemSettings: (url: string): Promise<void> => ipcRenderer.invoke('shell:open-system-settings', url),
    /* Only this side can say where a dragged file came from: `File.path` was taken out of Electron
       and the renderer has no `webUtils`. Empty for anything that is not a file on disk. */
    pathForFile: (file: File): string | null => webUtils.getPathForFile(file) || null,
    openGuestDevTools: (webContentsId: number): void => ipcRenderer.send('devtools:guest', webContentsId),
    capturePage: (webContentsId: number): Promise<Uint8Array | null> => ipcRenderer.invoke('browser:capture', webContentsId),
    onBrowserContextMenu: subscribe<[params: BrowserContextParams]>('browser:context-menu'),
    browserContextAction: (action: BrowserContextAction): void => ipcRenderer.send('browser:context-action', action),
    onGuestFocus: subscribe<[webContentsId: number]>('guest:focus'),
    onOpenSettings: subscribe<[section: string | null]>('menu:settings'),
    setLanguage: (language: string): void => ipcRenderer.send('app:language', language),
    setMenu: (spec: MenuSpec): void => ipcRenderer.send('menu:set', spec),
    onMenuCommand: subscribe<[id: string]>('menu:run'),
    isFullscreen: (): Promise<boolean> => ipcRenderer.invoke('window:is-fullscreen'),
    onFullscreen: subscribe<[fullscreen: boolean]>('window:fullscreen'),
    setTheme: (theme: { resolved: 'light' | 'dark'; followsSystem: boolean; background: string }): void => ipcRenderer.send('window:theme', theme),
    claimWindow: (key: string | null): Promise<boolean> => ipcRenderer.invoke('window:claim', key),
    openWindow: (key: string | null, view?: string, at?: { x: number; y: number }): void => ipcRenderer.send('window:open', key, view ?? null, at ?? null),
    onShowView: subscribe<[view: string]>('window:show-view'),
    moveToNewWindow: (at?: { x: number; y: number }): Promise<boolean> => ipcRenderer.invoke('window:move-to-new', at ?? null),
    setWindowState: (state: string | null): void => ipcRenderer.send('window:state', state),
    closeWindowIfOthers: (): Promise<boolean> => ipcRenderer.invoke('window:close-if-others'),
    holdTabs: (keys: string[]): Promise<string[]> => ipcRenderer.invoke('window:hold', keys),
    tabDrag: (phase: 'start' | 'end', key: string, grab: { x: number; y: number }, whole: boolean, tabWidth?: number): Promise<boolean> =>
        ipcRenderer.invoke('window:tab-drag', phase, key, grab, whole, tabWidth ?? null),
    onShowProject: subscribe<[key: string]>('window:show-project'),
    onTakeProject: subscribe<[key: string, x: number | null]>('window:take-project'),
    onReleaseProject: subscribe<[key: string]>('window:release-project'),
    onTabDragOver: subscribe<[key: string, x: number]>('window:tab-drag-over'),
    setTabStrip: (rect: { x: number; y: number; width: number; height: number } | null): void => ipcRenderer.send('window:tab-strip', rect),
    setKeepAwake: (keep: boolean): void => ipcRenderer.send('power:keep-awake', keep),
    requestKeepAwake: (request: KeepAwakeRequest | null): void => ipcRenderer.send('power:keep-awake-request', request),
    idleState: (thresholdSeconds: number): Promise<SystemIdleState> => ipcRenderer.invoke('power:idle-state', thresholdSeconds),
    setAgentActivity: (activity: { working: number; attention: number }): void => ipcRenderer.send('agents:activity', activity),
    saveFile: (suggestedName: string, bytes: Uint8Array, mime: string): Promise<string | null> =>
        ipcRenderer.invoke('dialog:save-file', suggestedName, bytes, mime),
    saveFileStream: {
        begin: (suggestedName: string, mime: string): Promise<string | null> => ipcRenderer.invoke('save-stream:begin', suggestedName, mime),
        write: (id: string, bytes: Uint8Array): Promise<void> => ipcRenderer.invoke('save-stream:write', id, bytes),
        end: (id: string): Promise<string> => ipcRenderer.invoke('save-stream:end', id),
        abort: (id: string): Promise<void> => ipcRenderer.invoke('save-stream:abort', id)
    },
    openImage: (suggestedName: string, bytes: Uint8Array, mime: string): Promise<void> => ipcRenderer.invoke('image:open', suggestedName, bytes, mime),
    chooseSavePath: (request: SavePathRequest): Promise<string | null> => ipcRenderer.invoke('dialog:choose-save-path', request),
    chooseOpenPath: (request: OpenPathRequest): Promise<string | null> => ipcRenderer.invoke('dialog:choose-open-path', request),
    /* Only where the shell knows how to reach the file manager's clipboard (`file-clipboard.ts`), so elsewhere the client offers no copy. */
    copyFiles:
        process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
            ? (paths: string[]): Promise<boolean> => ipcRenderer.invoke('clipboard:copy-files', paths)
            : undefined,
    updateState: (): Promise<UpdateState> => ipcRenderer.invoke('update:state'),
    onUpdateState: subscribe<[state: UpdateState]>('update:state'),
    configureUpdates: (autoDownload: boolean): Promise<void> => ipcRenderer.invoke('update:configure', autoDownload),
    configureUpdateTrack: (track: UpdateTrack): Promise<void> => ipcRenderer.invoke('update:track', track),
    checkForUpdate: (): Promise<void> => ipcRenderer.invoke('update:check'),
    downloadUpdate: (): Promise<void> => ipcRenderer.invoke('update:download'),
    installUpdate: (confirmed?: boolean): void => ipcRenderer.send('update:install', confirmed === true),
    releaseNotes: (refresh?: boolean): Promise<ReleaseNotesState> => ipcRenderer.invoke('releases:list', refresh === true),
    requestMicrophoneAccess: (): Promise<boolean> => ipcRenderer.invoke('media:request-microphone'),
    openAi: {
        credentialStatus: (): Promise<OpenAiCredentialStatus> => ipcRenderer.invoke('openai:credential-status'),
        saveApiKey: (apiKey: string): Promise<OpenAiCredentialStatus> => ipcRenderer.invoke('openai:save-api-key', apiKey),
        clearApiKey: (): Promise<OpenAiCredentialStatus> => ipcRenderer.invoke('openai:clear-api-key'),
        createLiveSession: (sdp: string, preferences: OpenAiLivePreferences): Promise<LiveSession> =>
            ipcRenderer.invoke('openai:create-live-session', sdp, preferences)
    },
    databaseSecrets: {
        read: (key: string): Promise<string | null> => ipcRenderer.invoke('database:secret-read', key),
        write: (key: string, secret: string | null): Promise<void> => ipcRenderer.invoke('database:secret-write', key, secret),
        persistent: (): Promise<boolean> => ipcRenderer.invoke('database:secret-persistent')
    },
    speech: {
        state: (): Promise<SpeechState> => ipcRenderer.invoke('speech:state'),
        setEnabled: (enabled: boolean): Promise<SpeechState> => ipcRenderer.invoke('speech:enable', enabled),
        removeModel: (): Promise<SpeechState> => ipcRenderer.invoke('speech:remove'),
        start: (id: string, language: string): Promise<void> => ipcRenderer.invoke('speech:start', id, language),
        samples: (id: string, samples: Float32Array): Promise<void> => ipcRenderer.invoke('speech:samples', id, samples),
        stop: (id: string): Promise<void> => ipcRenderer.invoke('speech:stop', id),
        cancel: (id: string): Promise<void> => ipcRenderer.invoke('speech:cancel', id),
        onState: subscribe<[state: SpeechState]>('speech:state'),
        onEvent: subscribe<[event: SpeechEvent]>('speech:event')
    },
    microphone: {
        claim: (): void => ipcRenderer.send('microphone:claim'),
        onClaimed: subscribe<[]>('microphone:claimed')
    },
    machine: {
        mode: machineMode,
        stopPreview: (): Promise<MachineStopPreview> => ipcRenderer.invoke('machine:stop-preview'),
        choose: (mode: 'local' | 'none'): Promise<void> => ipcRenderer.invoke('machine:choose', mode)
    },
    ...(machineMode === 'local' ? localMachineBridge : {}),
    ...(machineMode === 'local' && process.platform === 'darwin' ? quickLookBridge : {}),
    pulsar: {
        addressBook: (): Promise<string> => ipcRenderer.invoke('pulsar:address-book'),
        listen: (): Promise<{ redirectUri: string }> => ipcRenderer.invoke('pulsar:login-listen'),
        callback: (): Promise<unknown> => ipcRenderer.invoke('pulsar:login-callback'),
        cancel: (): Promise<void> => ipcRenderer.invoke('pulsar:login-cancel'),
        exchange: (payload: unknown): Promise<unknown> => ipcRenderer.invoke('pulsar:exchange', payload),
        refresh: (): Promise<unknown> => ipcRenderer.invoke('pulsar:refresh'),
        restore: (): Promise<unknown> => ipcRenderer.invoke('pulsar:restore'),
        signOut: (): Promise<void> => ipcRenderer.invoke('pulsar:sign-out')
    }
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld('ruimteDesktop', bridge);
