import { existsSync } from 'node:fs';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { answerAppRequest, createDesktopAppScheme } from './app-scheme';
import { installBrowserRoutes } from './browser-routes';
import { LAUNCHER_PIPE_VARIABLE } from './launcher-pipe';
import { moveLegacyStorage } from './legacy-storage';
import { MACHINE_ARGUMENT } from './machine-argument';
import { decideMachineMode, hasInstallTraces, machineModeFile, parseModeOverride } from './machine-mode';
import {
    createGestureGate,
    createPageKeys,
    createTheme,
    createUpdater,
    createWindows,
    type WindowOrigin,
    createWindowState,
    fileStorage
} from '@adecore/shell';
import type { ThemeState } from '@adecore/shell/bridge';
import { type AgentActivity, type KeepAwakeRequest } from '@ruimte/desktop-bridge';
import { isWindowKey, isWindowState, isWindowView, tabStripOf, totalActivity, windowPointOf, windowUrl } from './app-windows';
import { createTabDrag } from './tab-drag';
import { editFrameOf, runGuestEdit } from './guest-edit';
import { contextMenuPayload, editableMenuTemplate, PREVIEW_ACTIONS, type BrowserContextAction, type GuestKind } from './guest-menu';
import { askDaemonWork, handVoiceKey } from './daemon-proof';
import { createKeepAwakeHold, keepAwakeBlocker, keepAwakeRequestFrom, LEGACY_KEEP_AWAKE, mergeKeepAwake } from './keep-awake';
import { installDialogs } from './main/dialogs';
import { electron } from './main/electron';
import { createAppIpc } from './main/ipc';
import { installLogin } from './main/login';
import { installMachineMode } from './main/machine-mode';
import { installMenu } from './main/menu';
import { installSecrets } from './main/secrets';
import { installQuickLook } from './main/quick-look';
import { createMachine } from './main/service';
import { installSpeech } from './main/speech';
import { startTelemetry } from './main/telemetry';
import { installUsage } from './main/usage';
import { quitQuestion } from './quit-question';
import { createReleaseNotes } from './release-notes';
import { runSmoke } from './smoke';
import { installSocketTypeOfServiceGuard } from './socket-tos-guard';
import { startApp } from './startup';
import { appSubframeNavigation, BROWSER_PARTITION, isExternalLink, PREVIEW_PARTITION } from './web-guards';

const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, net, powerMonitor, powerSaveBlocker, protocol, screen, session, shell, webContents } = electron;

// A checkout keeps its own port, name and profile, so it runs beside an installed Ruimte instead of
// quitting on that app's single instance lock or talking to its daemon.
const DEFAULT_PORT = app.isPackaged ? 4210 : 4211;
if (!app.isPackaged) {
    app.setName('Ruimte Dev');
    app.setPath('userData', join(app.getPath('appData'), 'Ruimte Dev'));
}
// Before the app is ready, so the crash handler watches every process from the first one on.
startTelemetry();
installSocketTypeOfServiceGuard();
// The bundler inlines __dirname as the source path; the app path is where the built files are.
const here = join(app.getAppPath(), 'dist');
const repoRoot = resolve(app.getAppPath(), '..', '..');

// In development `bun dev` already runs the daemon and Vite; the shell just opens the dev URL.
const devUrl = process.env.RUIMTE_DEV_URL ?? null;
const smoke = process.env.RUIMTE_SMOKE === '1';
// Where the smoke run writes the top-left of the window, which is how the title bar is measured instead of guessed.
const capturePath = process.env.RUIMTE_CAPTURE ?? null;

// Whether this app runs a machine of its own; without one nothing below starts a daemon or reads the local secret.
const machineModeStore = machineModeFile(join(app.getPath('userData'), 'machine.json'));
const decidedMode = decideMachineMode({
    // A packaged app takes its mode from the file alone; the override is for checkouts and the smoke run.
    override: !app.isPackaged || smoke ? parseModeOverride(process.env.RUIMTE_MACHINE) : null,
    stored: machineModeStore.read(),
    traces: hasInstallTraces((name) => existsSync(join(app.getPath('userData'), name))),
    smoke
});
if (decidedMode.write) {
    try {
        machineModeStore.write(decidedMode.write);
    } catch (e) {
        // The traces or the question decide again at the next start.
        console.warn('The machine mode could not be stored:', e instanceof Error ? e.message : e);
    }
}
const machineMode = decidedMode.mode;
const localMachine = machineMode === 'local';
const port = Number(process.env.RUIMTE_PORT ?? DEFAULT_PORT);
// The home the daemon runs with, where its local secret lives; a checkout uses the dev home, as the server's `bun dev` does.
const ruimteHome = app.isPackaged ? (process.env.RUIMTE_HOME ?? join(homedir(), '.ruimte')) : (process.env.RUIMTE_DEV_HOME ?? join(homedir(), '.ruimte-dev'));

function clientRoot(): string {
    return app.isPackaged ? join(process.resourcesPath, 'client') : join(repoRoot, 'apps', 'client', 'dist');
}

// The page is the shell's own, from the build in its resources; only `bun dev` serves it from Vite.
const scheme = createDesktopAppScheme(clientRoot(), devUrl ?? undefined);
const daemonUrl = `http://127.0.0.1:${port}`;

protocol.registerSchemesAsPrivileged([scheme.privileged]);

const devtoolsWindows = new Map<number, Electron.BrowserWindow>();

function fromAppWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    return scheme.isAppSender(windows.fromPage(event.sender) !== null, event.senderFrame);
}

const ipc = createAppIpc(ipcMain, fromAppWindow, (contents) => windows.fromPage(contents));

const machine = createMachine({ ipc, port, ruimteHome, repoRoot, devUrl, mode: machineMode, publish: (state) => windows.send('service:state', state) });

// The band the client reserves across the sidebar's strip and the toolbar, which the overlay controls share on Linux.
const TITLEBAR_HEIGHT = 48;
const OVERLAY_COLORS = { dark: { color: '#1b1b1f', symbolColor: '#ececf1' }, light: { color: '#ffffff', symbolColor: '#18181b' } };

/*
 * The client owns the theme and reports it with its color, so `styles.css` stays the one place the
 * token is written; the shell paints it on the window controls, the window and every webview's
 * `prefers-color-scheme`.
 */
const theme = createTheme({
    nativeTheme,
    windows: () => windows.all(),
    background: '#131316',
    overlay: { height: TITLEBAR_HEIGHT, colors: OVERLAY_COLORS },
    // Controls over the page cover the side panels' own buttons there, so Windows gets its title bar and menu bar.
    nativeFrame: process.platform === 'win32'
});

let browserRoutes: ReturnType<typeof installBrowserRoutes>;

function isGuestOf(contents: Electron.WebContents, partition: string): boolean {
    return contents.getType() === 'webview' && contents.session === session.fromPartition(partition);
}

function isBrowserGuest(contents: Electron.WebContents): boolean {
    return isGuestOf(contents, BROWSER_PARTITION);
}

function isPreviewGuest(contents: Electron.WebContents): boolean {
    return isGuestOf(contents, PREVIEW_PARTITION);
}

const LOCAL_SCHEMES = ['file:', 'data:', 'blob:', 'about:'];

/* A previewed file may load adjacent assets, but cannot use its scripts to reach a server or, without a press of the person, the system browser. */
function sealPreviewSession(): void {
    const preview = session.fromPartition(PREVIEW_PARTITION);
    preview.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !LOCAL_SCHEMES.some((scheme) => details.url.startsWith(scheme)) }));
    preview.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

/* Network links a person clicks leave the sealed preview instead of failing silently inside it. */
function routePreviewLinks(contents: Electron.WebContents): void {
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

/* Nothing but the app loads in its window: a dropped link or file would otherwise take the bridge with it. */
function guardAppNavigation(contents: Electron.WebContents): void {
    contents.on('will-navigate', (event) => {
        const verdict = scheme.navigation(event.url);
        if (verdict === 'allow') {
            return;
        }
        event.preventDefault();
        if (verdict === 'external') {
            void shell.openExternal(event.url);
        }
    });
    // Nobody chose where a redirect goes, so one that leaves the app only stops.
    contents.on('will-redirect', (event) => {
        const verdict = event.isMainFrame ? scheme.navigation(event.url) : appSubframeNavigation(event.url, event.frame, scheme.isAppUrl);
        if (verdict !== 'allow') {
            event.preventDefault();
        }
    });
    // The main frame is `will-navigate`'s, which is the one that may hand a link to the system browser.
    contents.on('will-frame-navigate', (event) => {
        if (!event.isMainFrame && appSubframeNavigation(event.url, event.frame, scheme.isAppUrl) !== 'allow') {
            event.preventDefault();
        }
    });
}

function setOrDelete<Value>(map: Map<number, Value>, key: number, value: Value | null): void {
    if (value === null) {
        map.delete(key);
    } else {
        map.set(key, value);
    }
}

// By window id. Kept rather than applied once, since the power source changes while a request stands.
const keepAwakeRequests = new Map<number, KeepAwakeRequest>();

const holdKeepAwake = createKeepAwakeHold(powerSaveBlocker);

function applyKeepAwake(): void {
    const request = mergeKeepAwake(keepAwakeRequests.values());
    // `powerMonitor` only answers once the app is ready, and a request only arrives from a window after that.
    const onBattery = request !== null && powerMonitor.isOnBatteryPower();
    holdKeepAwake(keepAwakeBlocker(request, { platform: process.platform, onBattery }));
}

function setKeepAwake(windowId: number, request: KeepAwakeRequest | null): void {
    setOrDelete(keepAwakeRequests, windowId, request);
    applyKeepAwake();
}

ipc.on('power:keep-awake', (event, keep: boolean) => {
    const window = ipc.senderWindow(event);
    if (window) {
        setKeepAwake(window.id, keep === true ? LEGACY_KEEP_AWAKE : null);
    }
});
ipc.on('power:keep-awake-request', (event, request: unknown) => {
    const window = ipc.senderWindow(event);
    if (window) {
        setKeepAwake(window.id, keepAwakeRequestFrom(request));
    }
});
ipc.handle('power:idle-state', (_event, thresholdSeconds: unknown) => {
    const threshold = typeof thresholdSeconds === 'number' && Number.isInteger(thresholdSeconds) && thresholdSeconds > 0 ? thresholdSeconds : 120;
    return powerMonitor.getSystemIdleState(threshold);
});

// By window id. The shell counts nothing itself, so the badge and the quit dialog agree with the toolbar.
const agentActivities = new Map<number, AgentActivity>();
let agentActivity: AgentActivity = { working: 0, attention: 0 };

function setAgentActivity(windowId: number, activity: AgentActivity | null): void {
    setOrDelete(agentActivities, windowId, activity);
    agentActivity = totalActivity(agentActivities.values());
    // A dock badge is macOS and Linux; Windows has none and Electron's call does nothing there.
    if (process.platform !== 'win32') {
        app.setBadgeCount(agentActivity.attention);
    }
}

ipc.on('agents:activity', (event, activity: AgentActivity) => {
    const window = ipc.senderWindow(event);
    if (window) {
        setAgentActivity(window.id, typeof activity === 'object' && activity !== null ? activity : null);
    }
});

/* A window that closes or reloads takes what it asked for with it; its page asks again once it is back. */
function dropWindowShares(windowId: number): void {
    setKeepAwake(windowId, null);
    setAgentActivity(windowId, null);
}

/* Set when a quit needs no question: an install asked before it closed the windows, or the launcher's pipe closed. */
let quitConfirmed = false;
let interfaceLanguage: string | null = null;
ipc.on('app:language', (_event, language: unknown) => {
    if (language === 'en' || language === 'nl') {
        interfaceLanguage = language;
    }
});
/*
 * Under `bun dev` the launcher hands down a pipe (`scripts/launch.ts`); when it closes the app quits
 * without asking. A signal cannot tell: Chromium turns the first SIGINT into a quit the question holds up.
 */
const launcherPipe = process.env[LAUNCHER_PIPE_VARIABLE];
delete process.env[LAUNCHER_PIPE_VARIABLE];
if (launcherPipe !== undefined) {
    const pipe = new Socket({ fd: Number(launcherPipe), readable: true, writable: false });
    pipe.on('close', () => {
        quitConfirmed = true;
        app.quit();
    });
    pipe.on('error', () => undefined);
    pipe.resume();
    pipe.unref();
}

// The machine is asked what runs on it only when the quit ends it; the last window may be gone already.
async function askBeforeQuit(): Promise<boolean> {
    const survives = machine.controller.survivesQuit(machine.stopsOnQuit());
    const question = quitQuestion({
        language: interfaceLanguage ?? app.getPreferredSystemLanguages()[0],
        survives,
        elsewhere: !localMachine,
        windows: agentActivity,
        machine: survives ? null : await askDaemonWork(machine.daemonPort)
    });
    if (question === null) {
        return true;
    }
    const parent = windows.focused();
    const { response } = parent ? await dialog.showMessageBox(parent, question) : await dialog.showMessageBox(question);
    return response === 0;
}

const pageKeys = createPageKeys();

/*
 * The page already asked, so the quit that follows asks nothing; it still takes down the service this
 * installation owns when the choice said so. Under `bun dev` the relaunched app is no longer tied to
 * the launcher's pipe, so Ctrl+C in that terminal does not close it.
 */
function relaunchApp(): void {
    quitConfirmed = true;
    app.relaunch(process.env.APPIMAGE ? { execPath: process.env.APPIMAGE } : undefined);
    app.quit();
}

installMachineMode(ipc, { mode: machineMode, machine, store: machineModeStore, relaunch: relaunchApp });

const menu = installMenu(ipc, {
    pageKeys,
    focused: () => windows.focused(),
    keyBypassesPage: () => {
        const focused = webContents.getFocusedWebContents();
        return focused !== null && (isBrowserGuest(focused) || isPreviewGuest(focused));
    },
    canStopMachine: localMachine && machine.support === 'supported',
    stopMachine: () => machine.stopAndQuit(),
    openWindow: () => windows.open(null)
});

const windowState = createWindowState({
    storage: fileStorage(join(app.getPath('userData'), 'window-state.json')),
    displays: () => screen.getAllDisplays(),
    defaults: { width: 1440, height: 900 }
});

// `windows.open` calls `createWindow` in the same tick, which takes this.
let openingView: string | null = null;
/* A window a tab tears off into opens without the focus, so the window that holds the press keeps getting its pointer. */
let openingInactive = false;

function createWindow(
    key: string | null,
    bounds: Partial<Electron.Rectangle> & { width: number; height: number },
    origin: WindowOrigin,
    state: string | null
): Electron.BrowserWindow {
    const view = openingView;
    openingView = null;
    const inactive = openingInactive;
    openingInactive = false;
    const window = new BrowserWindow({
        ...bounds,
        minWidth: 800,
        minHeight: 500,
        show: false,
        ...theme.windowOptions(),
        webPreferences: {
            preload: join(here, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            // The bridge, the local secret included, stays in the top frame: a visual's page runs in a frame of this page.
            nodeIntegrationInSubFrames: false,
            webviewTag: true,
            // `app.getLocale()` is the bundle's language, `en-US` even on a Dutch Mac; these follow the
            // Region setting and the language order of System Settings.
            additionalArguments: [
                `--ruimte-system-locale=${app.getSystemLocale()}`,
                `--ruimte-system-languages=${app.getPreferredSystemLanguages().join(',')}`,
                `${MACHINE_ARGUMENT}${machineMode}`,
                // Under `bun dev` the page reaches its machine through Vite's proxy on its own origin instead.
                ...(localMachine && !devUrl ? [`--ruimte-daemon-url=${daemonUrl}`] : [])
            ]
        }
    });
    const id = window.id;
    const contents = window.webContents;
    // A window back from the last session or the first of a start is no window a person opened.
    if (origin === 'opened') {
        usage.windowOpened();
    }
    window.once('ready-to-show', () => (inactive ? window.showInactive() : window.show()));
    contents.on('before-input-event', (_event, input) => pageKeys.saw(input));
    window.on('closed', () => {
        menu.forget(id);
        dropWindowShares(id);
        // The last window took the page that answers the menu with it, and Quit still has to be there.
        if (windows.all().every((other) => other === window)) {
            menu.setStatic();
        }
    });
    // Reset client-owned state on main-frame reload; subframe loads must not release the power block.
    contents.on('did-start-loading', () => {
        if (!contents.isLoadingMainFrame()) {
            return;
        }
        dropWindowShares(id);
        menu.forget(id);
        if (windows.focused() === window) {
            menu.setStatic();
        }
    });
    let recoveredAt = 0;
    // Without a page nobody answers a command, but Quit still has to be there.
    contents.on('render-process-gone', (_event, details) => {
        menu.forget(id);
        if (windows.focused() === window) {
            menu.setStatic();
        }
        // Electron leaves a dead page blank; the window's address holds what it showed, so a reload puts it back.
        // A page that dies again within a minute stays down rather than crash in a loop.
        const now = Date.now();
        if (details.reason === 'clean-exit' || window.isDestroyed() || now - recoveredAt < 60_000) {
            return;
        }
        recoveredAt = now;
        contents.reload();
    });
    // In fullscreen macOS hides the traffic lights, so the client can take the room back.
    window.on('enter-full-screen', () => contents.send('window:fullscreen', true));
    window.on('leave-full-screen', () => contents.send('window:fullscreen', false));
    // Links a page opens in a new window go to the system browser, never to another Electron window.
    contents.setWindowOpenHandler(({ url }) => {
        if (isExternalLink(url)) {
            void shell.openExternal(url);
        }
        return { action: 'deny' };
    });
    guardAppNavigation(contents);
    browserRoutes.attachApp(contents);
    // The smoke run opens its one window the way a start without a session does.
    // A window back from the last session starts nothing until a person comes to it.
    void window.loadURL(windowUrl(scheme.url, key, origin === 'first' || smoke, view, state, origin === 'session' && !smoke)).catch(() => undefined);
    return window;
}

const windows = createWindows({
    state: windowState,
    // Where the one window stood before there were several.
    formerKey: 'main',
    session: fileStorage(join(app.getPath('userData'), 'window-session.json')),
    create: createWindow,
    onFront: (window) => menu.applyOf(window)
});

// Audio for the app's own pages only. Set once on the shared session: a handler per window would leave only the last one able to ask.
function sealAppSession(): void {
    const own = session.defaultSession;
    // Electron 45 reports a screen capture as display-capture instead of media; no page of ours captures the screen.
    own.setPermissionCheckHandler((requester, permission, _origin, details) => {
        if (permission === 'display-capture') {
            return false;
        }
        if (permission !== 'media') {
            return true;
        }
        return requester !== null && windows.fromPage(requester) !== null && details.isMainFrame && details.mediaType === 'audio';
    });
    own.setPermissionRequestHandler((requester, permission, callback, details) => {
        if (permission === 'display-capture') {
            callback(false);
            return;
        }
        if (permission !== 'media') {
            callback(true);
            return;
        }
        const mediaTypes = 'mediaTypes' in details ? details.mediaTypes : undefined;
        callback(windows.fromPage(requester) !== null && details.isMainFrame && mediaTypes?.length === 1 && mediaTypes[0] === 'audio');
    });
}

/* Opens the inspector for a guest page, on the element under `at` when a point comes with it. */
function guestDevTools(id: number, at?: { x: number; y: number }): void {
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
}

function editableGuestMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams, inspectable: boolean): void {
    const template = editableMenuTemplate(params, process.platform, {
        replaceMisspelling: (word) => contents.replaceMisspelling(word),
        lookUp: () => contents.showDefinitionForSelection(),
        openExternal: (url) => void shell.openExternal(url),
        ...(inspectable ? { inspect: () => guestDevTools(contents.id, { x: params.x, y: params.y }) } : {})
    });
    /*
     * The frame is what makes macOS append AutoFill, Writing Tools and Services; without it (navigated
     * away or dead) the menu still opens, without those rows. AutoFill reaches Apple's Passwords app only.
     */
    Menu.buildFromTemplate(template).popup({ window: windows.fromContents(contents) ?? undefined, ...(params.frame ? { frame: params.frame } : {}) });
}

/* The frame each guest's last right-click landed in, so copy and select all act where the person pointed. */
const menuFrames = new WeakMap<Electron.WebContents, Electron.WebFrameMain>();

/*
 * Electron ships no menu for web content and a native one reads as another program's, so the client
 * draws it. An editable field stays native, since what the platform adds there is worth more.
 */
function guestContextMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams, guest: GuestKind): void {
    if (params.isEditable) {
        editableGuestMenu(contents, params, guest === 'browser');
        return;
    }
    if (params.frame) {
        menuFrames.set(contents, params.frame);
    } else {
        menuFrames.delete(contents);
    }
    // A guest of no window of ours gets none.
    windows.fromContents(contents)?.webContents.send('browser:context-menu', contextMenuPayload(contents.id, guest, params));
}

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
            guestDevTools(contents.id, { x: payload.x ?? 0, y: payload.y ?? 0 });
            return;
        case 'open-external':
            if (payload.url && /^https?:\/\//.test(payload.url)) {
                void shell.openExternal(payload.url);
            }
            return;
    }
});

installDialogs(ipc, () => interfaceLanguage ?? undefined);

ipc.on('devtools:guest', (_event, id: number) => guestDevTools(id));

// For an agent that asked what the page it drives looks like. A guest's own preload has none of this.
ipc.handle('browser:capture', async (_event, id: number) => {
    const guest = webContents.fromId(id);

    return guest ? (await guest.capturePage()).toPNG() : null;
});

const secrets = installSecrets(ipc, localMachine ? (key) => handVoiceKey(machine.daemonPort, key) : null);
installSpeech(ipc, { ruimteHome, repoRoot, send: (channel, payload) => windows.send(channel, payload), windows: () => windows.all() });
const login = installLogin(ipc);
const usage = installUsage(ipc, { mode: machineMode, ruimteHome, signedIn: login.signedIn });
if (localMachine && process.platform === 'darwin') {
    installQuickLook(ipc, { ruimteHome, keyOf: (window) => windows.keyOf(window) });
}

ipc.handle('window:is-fullscreen', (event) => ipc.senderWindow(event)?.isFullScreen() ?? false);

/*
 * A project is in one window at a time: when another window has it, that one comes to the front and
 * the page stays where it was. Null lets the window's project go.
 */
ipc.handle('window:claim', (event, key: unknown) => {
    const window = ipc.senderWindow(event);
    if (window === null || (key !== null && !isWindowKey(key))) {
        return false;
    }
    if (windows.claim(window, key)) {
        return true;
    }
    showOnHolder(key);
    return false;
});

/* A window that keeps a project as a tab it does not show is asked to show it, once it came to the front. */
function showOnHolder(key: string | null): void {
    const holder = key === null ? null : windows.holderOf(key);
    if (holder !== null && windows.keyOf(holder) !== key) {
        holder.webContents.send('window:show-project', key);
    }
}

// The tabs a window keeps; a project another window keeps stays there, so the answer is what this window has.
ipc.handle('window:hold', (event, keys: unknown) => {
    const window = ipc.senderWindow(event);
    if (window === null || !Array.isArray(keys) || keys.length > 512 || !keys.every(isWindowKey)) {
        return [];
    }
    return windows.hold(window, keys);
});

/* Keeps a window that tears off at `at`, as big as `size`, on the work area of the display it lands on, its top fully. */
function onScreen(at: { x: number; y: number }, size: { width: number; height: number }): { x: number; y: number } {
    const area = screen.getDisplayNearestPoint(at).workArea;
    return {
        x: Math.min(Math.max(at.x, area.x), Math.max(area.x, area.x + area.width - Math.min(size.width, area.width))),
        y: Math.min(Math.max(at.y, area.y), Math.max(area.y, area.y + area.height - Math.min(size.height, area.height)))
    };
}

/* Where each window's page draws its tab strip, in the page's coordinates, for a tab dragged over it. */
const tabStrips = new Map<number, { x: number; y: number; width: number; height: number }>();

ipc.on('window:tab-strip', (event, rect: unknown) => {
    const window = ipc.senderWindow(event);
    if (window === null) {
        return;
    }
    const strip = tabStripOf(rect);
    if (strip === null) {
        tabStrips.delete(window.id);
        return;
    }
    if (!tabStrips.has(window.id)) {
        window.once('closed', () => tabStrips.delete(window.id));
    }
    tabStrips.set(window.id, strip);
});

const tabDrag = createTabDrag<Electron.BrowserWindow>({
    detach: (window, key, at) => {
        openingInactive = true;
        try {
            return windows.detach(window, key, onScreen(at, window.getBounds()));
        } finally {
            openingInactive = false;
        }
    },
    transfer: (key, window) => windows.transfer(key, window),
    windowAt: (point, except) => windows.windowAt(point, except),
    stripOf: (window) => tabStrips.get(window.id) ?? null,
    stripX: (window, point) => {
        const strip = tabStrips.get(window.id);
        if (strip === undefined) {
            return null;
        }
        const content = window.getContentBounds();
        const x = point.x - content.x;
        const y = point.y - content.y;
        return x >= strip.x && x < strip.x + strip.width && y >= strip.y && y < strip.y + strip.height ? x : null;
    },
    cursor: () => screen.getCursorScreenPoint(),
    every: (tick) => {
        const timer = setInterval(tick, 16);
        return () => clearInterval(timer);
    },
    onFront: (window, listener) => {
        window.on('focus', listener);
        return () => window.removeListener('focus', listener);
    }
});

// The page that holds the press says when a tab leaves its window and when the press lets go.
ipc.handle('window:tab-drag', (event, phase: unknown, key: unknown, grab: unknown, whole: unknown, tabWidth: unknown) => {
    const window = ipc.senderWindow(event);
    if (window === null) {
        return false;
    }
    if (phase === 'end') {
        tabDrag.end();
        return true;
    }
    const point = windowPointOf(grab);
    const width = typeof tabWidth === 'number' && Number.isFinite(tabWidth) && tabWidth > 0 ? tabWidth : null;
    return phase === 'start' && isWindowKey(key) && point !== undefined && tabDrag.start(window, key, point, whole === true, width);
});

// Null opens the start screen. A view goes in a new window's address, or as a message to one that already shows the project.
ipc.on('window:open', (_event, key: unknown, view: unknown, at: unknown) => {
    if (key !== null && !isWindowKey(key)) {
        return;
    }
    const shown = key !== null && isWindowView(view) ? view : null;
    const holder = key === null ? null : windows.holderOf(key);
    if (holder !== null) {
        windows.open(key);
        showOnHolder(key);
        if (shown !== null) {
            holder.webContents.send('window:show-view', shown);
        }
        return;
    }
    openingView = shown;
    try {
        windows.open(key, windowPointOf(at));
    } finally {
        openingView = null;
    }
});

// Handed over in one tick, so nobody ever holds the project; the asking page goes to the start screen on true.
ipc.handle('window:move-to-new', (event, at: unknown) => {
    const window = ipc.senderWindow(event);
    return window !== null && windows.move(window, windowPointOf(at)) !== null;
});

// A window whose last tab closed goes, as long as it is not the last window.
ipc.handle('window:close-if-others', (event) => {
    const window = ipc.senderWindow(event);
    if (window === null || windows.all().length < 2) {
        return false;
    }
    setImmediate(() => window.close());
    return true;
});

// What the page keeps of itself, such as its tabs, comes back in its address at the next start.
ipc.on('window:state', (event, state: unknown) => {
    const window = ipc.senderWindow(event);
    if (window !== null && isWindowState(state)) {
        windows.setState(window, state);
    }
});

ipc.on('window:theme', (_event, state: ThemeState) => theme.apply(state));

// A state machine the client watches, not a dialog that interrupts.
const updater = createUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    load: () => (require('electron-updater') as typeof import('electron-updater')).autoUpdater,
    publish: (state) => windows.send('update:state', state),
    onQuit: windows.quitForUpdate,
    // Refreshed with the check, so the notes of a version it finds are on disk before anyone asks.
    beforeCheck: () => void releaseNotes.list(true)
});

ipc.handle('update:state', () => updater.state());

ipc.handle('update:configure', (_event, autoDownload: unknown) => updater.configure(autoDownload));

ipc.handle('update:check', () => updater.check());

ipc.handle('update:download', () => updater.download());

/*
 * Installing closes every window before it quits, so a quit that ends work is asked about while they
 * are still there. Not when `confirmed`: a person asked from another client after being told what ends.
 */
async function installUpdate(confirmed: boolean): Promise<void> {
    if (!confirmed && !machine.controller.survivesQuit(false) && !(await askBeforeQuit())) {
        return;
    }
    quitConfirmed = true;
    if (!updater.install()) {
        quitConfirmed = false;
    }
}

ipc.on('update:install', (_event, confirmed: unknown) => void installUpdate(confirmed === true));

/* From the REST API: the updater's atom feed carries rendered HTML, only the versions up to the next one,
   and tags whose release is still a draft. */
const releaseNotes = createReleaseNotes({
    fetch: (url, init) => net.fetch(url, init),
    cacheFile: join(app.getPath('userData'), 'release-notes.json')
});

ipc.handle('releases:list', (_event, refresh?: boolean) => releaseNotes.list(refresh === true));

/* One window on what the page remembers, whatever the last session left open. */
async function runSmokeWindow(): Promise<void> {
    const window = windows.open(null);
    await new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve()));
    await runSmoke(window, {
        appUrl: scheme.url,
        capturePath,
        titleBarHeight: TITLEBAR_HEIGHT,
        scaleFactorOf: (shown) => screen.getDisplayMatching(shown.getBounds()).scaleFactor
    });
}

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    // The menu stays set, so its keys keep working; the logo in the sidebar shows it (`hasLogoMenu`).
    if (process.platform === 'win32') {
        app.on('browser-window-created', (_event, window) => window.setMenuBarVisibility(false));
    }
    app.on('web-contents-created', (_event, contents) => {
        /* Every webview says when it takes the focus: a press inside one never reaches the
           client's page, and the grid has to know which cell the keyboard went to. */
        if (contents.getType() === 'webview') {
            contents.on('focus', () => windows.fromContents(contents)?.webContents.send('guest:focus', contents.id));
        }
        if (isPreviewGuest(contents)) {
            routePreviewLinks(contents);
            contents.on('context-menu', (_e, params) => guestContextMenu(contents, params, 'preview'));
            return;
        }
        if (isBrowserGuest(contents)) {
            contents.on('context-menu', (_e, params) => guestContextMenu(contents, params, 'browser'));
        }
    });

    windows.attach(app, {
        confirmQuit: async ({ update }) => {
            if (!update && !quitConfirmed && !(await askBeforeQuit().catch(() => true))) {
                machine.keepOnQuit();
                return false;
            }
            await machine.settleBeforeQuit();
            machine.controller.quit(machine.stopsOnQuit());
            return true;
        }
    });

    app.on('will-quit', () => usage.quit());

    void app.whenReady().then(async () => {
        menu.setStatic();
        protocol.handle(scheme.scheme, (request) => answerAppRequest(scheme, request));
        sealAppSession();
        sealPreviewSession();
        browserRoutes = installBrowserRoutes(fromAppWindow, join(here, 'guest.cjs'));
        powerMonitor.on('on-battery', applyKeepAwake);
        powerMonitor.on('on-ac', applyKeepAwake);
        await startApp({
            localMachine,
            startMachine: () => machine.start(),
            moveStorage: () =>
                devUrl ? Promise.resolve(() => undefined) : moveLegacyStorage(port, join(app.getPath('userData'), 'storage-moved-to-app-scheme')),
            restoreWindows: () => windows.restore(),
            startUpdater: () => updater.start(),
            machineReady: () => {
                machine.ready();
                usage.started();
                void secrets.handOverVoiceKey();
            },
            fail: (message) => {
                dialog.showErrorBox('Ruimte', message);
            },
            quit: () => {
                quitConfirmed = true;
                app.quit();
            },
            ...(smoke ? { smoke: runSmokeWindow } : {})
        });
    });
}
