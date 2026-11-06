import { ipcSubscriber } from '@adecore/shell/bridge';
import type { DesktopBridge } from '@ruimte/desktop-bridge';
import type { EventArgs, EventChannel, InvokeArgs, InvokeChannel, InvokeResult, SendArgs, SendChannel } from '@ruimte/desktop-bridge/ipc';
import { modeFromArgv } from './machine-argument';

// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { contextBridge, ipcRenderer, webUtils } = require('electron') as typeof import('electron');

/* Where the main process puts the system's region and languages on the command line of this renderer. */
const LOCALE_ARGUMENT = '--ruimte-system-locale=';
const LANGUAGES_ARGUMENT = '--ruimte-system-languages=';
const DAEMON_URL_ARGUMENT = '--ruimte-daemon-url=';

function argument(prefix: string): string | undefined {
    return process.argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || undefined;
}

/* The three ways a page talks to the main process, each typed by the channel table in `@ruimte/desktop-bridge/ipc`. */
function invoke<C extends InvokeChannel>(channel: C, ...args: InvokeArgs<C>): Promise<InvokeResult<C>> {
    return ipcRenderer.invoke(channel, ...args);
}

function send<C extends SendChannel>(channel: C, ...args: SendArgs<C>): void {
    ipcRenderer.send(channel, ...args);
}

const subscribe = ipcSubscriber(ipcRenderer);

function on<C extends EventChannel>(channel: C) {
    return subscribe<EventArgs<C>>(channel);
}

const machineMode = modeFromArgv(process.argv);

/* The local secret and the service switch belong to a machine this app runs; without one they are not even offered. */
const localMachineBridge = {
    localSecret: () => invoke('daemon:local-secret'),
    takeStartupMs: () => invoke('usage:startup'),
    countUsage: (name) => send('usage:count', name),
    backgroundService: {
        state: () => invoke('service:state'),
        onState: on('service:state'),
        setKeepRunning: (keepRunning) => invoke('service:set-keep-running', keepRunning),
        enableLinger: () => invoke('service:enable-linger'),
        restartNow: () => invoke('service:restart-now'),
        restartWhenIdle: () => invoke('service:restart-when-idle'),
        stopMachine: () => send('service:stop-machine')
    }
} satisfies Pick<DesktopBridge, 'localSecret' | 'takeStartupMs' | 'countUsage' | 'backgroundService'>;

/* Quick Look reads the folder a project has on this disk, so only a shell with a machine of its own offers it. */
const quickLookBridge = {
    previewFile: (path) => invoke('quick-look:show', path),
    closeFilePreview: () => send('quick-look:close')
} satisfies Pick<DesktopBridge, 'previewFile' | 'closeFilePreview'>;

/* What the client may ask the shell for, checked against the type the client reads it through. */
const bridge = {
    extensions: {
        list: () => invoke('extensions:list'),
        install: (pack, options) => invoke('extensions:install', pack, options),
        remove: (id) => invoke('extensions:remove', id),
        setEnabled: (id, enabled) => invoke('extensions:set-enabled', id, enabled),
        link: (folder, revision, enabled) => invoke('extensions:link', folder, revision, enabled),
        unlink: (id) => invoke('extensions:unlink', id),
        onChanged: on('extensions:changed')
    },
    platform: process.platform,
    bindBrowserRoute: (binding) => invoke('browser:bind-route', binding),
    onBrowserRouteBlocked: on('browser:route-blocked'),
    versions: { electron: process.versions.electron, chrome: process.versions.chrome, node: process.versions.node },
    /* Handed down as an argument rather than fetched, because `app` is the main process alone and
       the client needs both before it draws its first word or its first number. */
    systemLocale: argument(LOCALE_ARGUMENT),
    systemLanguages: argument(LANGUAGES_ARGUMENT)?.split(','),
    daemonUrl: argument(DAEMON_URL_ARGUMENT),
    pickFolder: (initialPath) => invoke('dialog:pick-folder', initialPath),
    openExternal: (url) => invoke('shell:open-external', url),
    openSystemSettings: (url) => invoke('shell:open-system-settings', url),
    /* Only this side can say where a dragged file came from: `File.path` was taken out of Electron
       and the renderer has no `webUtils`. Empty for anything that is not a file on disk. */
    pathForFile: (file) => webUtils.getPathForFile(file) || null,
    openGuestDevTools: (webContentsId) => send('devtools:guest', webContentsId),
    capturePage: (webContentsId) => invoke('browser:capture', webContentsId),
    onBrowserContextMenu: on('browser:context-menu'),
    browserContextAction: (action) => send('browser:context-action', action),
    onGuestFocus: on('guest:focus'),
    onOpenSettings: on('menu:settings'),
    setLanguage: (language) => send('app:language', language),
    setMenu: (spec) => send('menu:set', spec),
    onMenuCommand: on('menu:run'),
    isFullscreen: () => invoke('window:is-fullscreen'),
    onFullscreen: on('window:fullscreen'),
    setTheme: (theme) => send('window:theme', theme),
    claimWindow: (key) => invoke('window:claim', key),
    openWindow: (key, view, at) => send('window:open', key, view ?? null, at ?? null),
    onShowView: on('window:show-view'),
    moveToNewWindow: (at) => invoke('window:move-to-new', at ?? null),
    setWindowState: (state) => send('window:state', state),
    closeWindowIfOthers: () => invoke('window:close-if-others'),
    holdTabs: (keys) => invoke('window:hold', keys),
    tabDrag: (phase, key, grab, whole, tabWidth) => invoke('window:tab-drag', phase, key, grab, whole, tabWidth ?? null),
    onShowProject: on('window:show-project'),
    onTakeProject: on('window:take-project'),
    onReleaseProject: on('window:release-project'),
    onTabDragOver: on('window:tab-drag-over'),
    setTabStrip: (rect) => send('window:tab-strip', rect),
    setKeepAwake: (keep) => send('power:keep-awake', keep),
    requestKeepAwake: (request) => send('power:keep-awake-request', request),
    idleState: (thresholdSeconds) => invoke('power:idle-state', thresholdSeconds),
    setAgentActivity: (activity) => send('agents:activity', activity),
    saveFile: (suggestedName, bytes, mime) => invoke('dialog:save-file', suggestedName, bytes, mime),
    saveFileStream: {
        begin: (suggestedName, mime) => invoke('save-stream:begin', suggestedName, mime),
        write: (id, bytes) => invoke('save-stream:write', id, bytes),
        end: (id) => invoke('save-stream:end', id),
        abort: (id) => invoke('save-stream:abort', id)
    },
    openImage: (suggestedName, bytes, mime) => invoke('image:open', suggestedName, bytes, mime),
    chooseSavePath: (request) => invoke('dialog:choose-save-path', request),
    chooseOpenPath: (request) => invoke('dialog:choose-open-path', request),
    /* Only where the shell knows how to reach the file manager's clipboard (`file-clipboard.ts`), so elsewhere the client offers no copy. */
    copyFiles:
        process.platform === 'darwin' || process.platform === 'linux' || process.platform === 'win32'
            ? (paths: string[]) => invoke('clipboard:copy-files', paths)
            : undefined,
    updateState: () => invoke('update:state'),
    onUpdateState: on('update:state'),
    configureUpdates: (autoDownload) => invoke('update:configure', autoDownload),
    configureUpdateTrack: (track) => invoke('update:track', track),
    checkForUpdate: () => invoke('update:check'),
    downloadUpdate: () => invoke('update:download'),
    installUpdate: (confirmed) => send('update:install', confirmed === true),
    releaseNotes: (refresh) => invoke('releases:list', refresh === true),
    requestMicrophoneAccess: () => invoke('media:request-microphone'),
    openAi: {
        credentialStatus: () => invoke('openai:credential-status'),
        saveApiKey: (apiKey) => invoke('openai:save-api-key', apiKey),
        clearApiKey: () => invoke('openai:clear-api-key'),
        createLiveSession: (sdp, preferences) => invoke('openai:create-live-session', sdp, preferences)
    },
    databaseSecrets: {
        read: (key) => invoke('database:secret-read', key),
        write: (key, secret) => invoke('database:secret-write', key, secret),
        persistent: () => invoke('database:secret-persistent')
    },
    speech: {
        state: () => invoke('speech:state'),
        setEnabled: (enabled) => invoke('speech:enable', enabled),
        removeModel: () => invoke('speech:remove'),
        start: (id, language) => invoke('speech:start', id, language),
        samples: (id, samples) => invoke('speech:samples', id, samples),
        stop: (id) => invoke('speech:stop', id),
        cancel: (id) => invoke('speech:cancel', id),
        onState: on('speech:state'),
        onEvent: on('speech:event')
    },
    microphone: {
        claim: () => send('microphone:claim'),
        onClaimed: on('microphone:claimed')
    },
    machine: {
        mode: machineMode,
        stopPreview: () => invoke('machine:stop-preview'),
        choose: (mode) => invoke('machine:choose', mode)
    },
    ...(machineMode === 'local' ? localMachineBridge : {}),
    ...(machineMode === 'local' && process.platform === 'darwin' ? quickLookBridge : {}),
    pulsar: {
        addressBook: () => invoke('pulsar:address-book'),
        listen: () => invoke('pulsar:login-listen'),
        callback: () => invoke('pulsar:login-callback'),
        cancel: () => invoke('pulsar:login-cancel'),
        exchange: (payload) => invoke('pulsar:exchange', payload),
        refresh: () => invoke('pulsar:refresh'),
        restore: () => invoke('pulsar:restore'),
        signOut: () => invoke('pulsar:sign-out')
    }
} satisfies DesktopBridge;

contextBridge.exposeInMainWorld('ruimteDesktop', bridge);
