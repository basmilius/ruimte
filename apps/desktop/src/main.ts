import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync } from 'node:fs';
import { readFile, rm, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildIdentityOf, MACHINE_HEALTH_PATH, type BuildIdentity } from '@ruimte/contracts';
import { answerAppRequest, createDesktopAppScheme } from './app-scheme';
import { installBrowserRoutes } from './browser-routes';
import { LAUNCHER_PIPE_VARIABLE } from './launcher-pipe';
import { moveLegacyStorage } from './legacy-storage';
import {
    createMenuCommands,
    createPageKeys,
    createTheme,
    createUpdater,
    createWindows,
    type WindowOrigin,
    createWindowState,
    devToolsAccelerator,
    fileStorage,
    menuTemplateOf,
    staticMenuTemplate
} from '@adecore/shell';
import type { ThemeState } from '@adecore/shell/bridge';
import { type AgentActivity, type BackgroundServiceState, type KeepAwakeRequest, type MenuShellAction, type MenuSpec } from '@ruimte/desktop-bridge';
import { isWindowKey, isWindowView, totalActivity, windowUrl } from './app-windows';
import { AddressBookClient, ADDRESS_BOOK_URL, SessionLoginCodeSchema, SessionVault } from '@ruimte/pulsar';
import { copyablePaths, fileClipboard, osClipboardFormat } from './file-clipboard';
import { openImageCopy } from './open-image';
import { allFilesLabel, databaseSecretFile, openDialogPlan, parseOpenPathRequest, parseSavePathRequest, parseSecret, parseSecretKey } from './database-bridge';
import { editFrameOf, runGuestEdit } from './guest-edit';
import { contextMenuPayload, editableMenuTemplate, PREVIEW_ACTIONS, type BrowserContextAction, type GuestKind } from './guest-menu';
import { askDaemonWork, proveDaemon, type DaemonPort } from './daemon-proof';
import { createKeepAwakeHold, keepAwakeBlocker, keepAwakeRequestFrom, LEGACY_KEEP_AWAKE, mergeKeepAwake } from './keep-awake';
import { listenForLogin, type LoopbackLogin } from './pulsar-login';
import { fileSessionKey, fileSessionStore } from './pulsar-store';
import { quitQuestion } from './quit-question';
import { createReleaseNotes } from './release-notes';
import { createServiceController } from './service/controller';
import { serviceDefinition as definitionFor, type ServiceManager } from '@adecore/service';
import { commandLineServiceProgram, daemonServiceSpec, platformServiceManager } from '@ruimte/service/host';
import { keepRunningSetting, serviceSupport } from './service/settings';
import { fileSecretStore, type SecretStore } from './secret-store';
import { createOpenAiLiveSession, parseOpenAiLivePreferences } from './openai-live';
import { SpeechService, speechHelperPath } from './speech';
import { SpeechModel } from './speech-model';
import { runSmoke } from './smoke';
import { appSubframeNavigation, BROWSER_PARTITION, createGestureGate, isExternalLink, isWebLink, isSystemSettingsPane, PREVIEW_PARTITION } from './web-guards';

// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const {
    app,
    BrowserWindow,
    clipboard,
    ClipboardItem,
    dialog,
    ipcMain,
    Menu,
    nativeTheme,
    net,
    powerMonitor,
    powerSaveBlocker,
    protocol,
    safeStorage,
    screen,
    session,
    shell,
    systemPreferences,
    webContents
} = require('electron') as typeof import('electron');

// Nothing crosses IPC that the WebSocket already carries.

// A checkout keeps its own port, name and profile, so it runs beside an installed Ruimte instead of
// quitting on that app's single instance lock or talking to its daemon.
const DEFAULT_PORT = app.isPackaged ? 4210 : 4211;
if (!app.isPackaged) {
    app.setName('Ruimte Dev');
    app.setPath('userData', join(app.getPath('appData'), 'Ruimte Dev'));
}
// The bundler inlines __dirname as the source path; the app path is where the built files are.
const here = join(app.getAppPath(), 'dist');
const repoRoot = resolve(app.getAppPath(), '..', '..');

// In development `bun dev` already runs the daemon and Vite; the shell just opens the dev URL.
const devUrl = process.env.RUIMTE_DEV_URL ?? null;
const smoke = process.env.RUIMTE_SMOKE === '1';
// Where the smoke run writes the top-left of the window, which is how the title bar is measured instead of guessed.
const capturePath = process.env.RUIMTE_CAPTURE ?? null;
const port = Number(process.env.RUIMTE_PORT ?? DEFAULT_PORT);
// The home the daemon runs with, where its local secret lives; a checkout uses the dev home, as the server's `bun dev` does.
const ruimteHome = app.isPackaged ? (process.env.RUIMTE_HOME ?? join(homedir(), '.ruimte')) : (process.env.RUIMTE_DEV_HOME ?? join(homedir(), '.ruimte-dev'));

// The page is the shell's own, from the build in its resources; only `bun dev` serves it from Vite.
const scheme = createDesktopAppScheme(clientRoot(), devUrl ?? undefined);
const daemonUrl = `http://127.0.0.1:${port}`;

protocol.registerSchemesAsPrivileged([scheme.privileged]);

let daemon: ChildProcess | null = null;
const devtoolsWindows = new Map<number, Electron.BrowserWindow>();

/*
 * Every channel answers the app's own pages and nothing else. A guest cannot reach one (its preload
 * only talks to its host), but a page the window was navigated to would inherit the bridge.
 */
function fromAppWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    return scheme.isAppSender(windows.fromPage(event.sender) !== null, event.senderFrame);
}

function senderWindow(event: { sender: Electron.WebContents }): Electron.BrowserWindow | null {
    return windows.fromPage(event.sender);
}

function refuseOtherPages(): never {
    throw new Error('Only the app window may ask this');
}

function handleFromApp<Args extends unknown[]>(channel: string, handler: (event: Electron.IpcMainInvokeEvent, ...args: Args) => unknown): void {
    ipcMain.handle(channel, (event, ...args) => (fromAppWindow(event) ? handler(event, ...(args as Args)) : refuseOtherPages()));
}

function onFromApp<Args extends unknown[]>(channel: string, listener: (event: Electron.IpcMainEvent, ...args: Args) => void): void {
    ipcMain.on(channel, (event, ...args) => {
        if (fromAppWindow(event)) {
            listener(event, ...(args as Args));
        }
    });
}

/*
 * An app opened from the Dock inherits a bare PATH, not the one the person's rc files build, and the
 * daemon finds `claude` and friends through PATH. So the login shell is asked once.
 */
let loginPath: string | null | undefined;

function loginShellPath(): string | null {
    loginPath ??= askLoginShellPath();
    return loginPath;
}

function askLoginShellPath(): string | null {
    if (process.platform === 'win32' || !process.env.SHELL) {
        return null;
    }
    const marker = '__RUIMTE_PATH__';
    const result = spawnSync(process.env.SHELL, ['-ilc', `printf '${marker}%s${marker}' "$PATH"`], {
        encoding: 'utf8',
        timeout: 5000,
        stdio: ['ignore', 'pipe', 'ignore']
    });
    const match = result.stdout?.match(new RegExp(`${marker}(.*?)${marker}`, 's'));
    return match?.[1] || null;
}

function daemonCommand(): { command: string; args: string[] } | null {
    if (app.isPackaged) {
        const bin = join(process.resourcesPath, 'bin');
        return { command: join(bin, process.platform === 'win32' ? 'ruimte.exe' : 'ruimte'), args: ['--port', String(port)] };
    }
    const entry = join(repoRoot, 'apps', 'server', 'src', 'main.ts');
    if (!existsSync(entry)) {
        return null;
    }
    return { command: 'bun', args: [entry, '--port', String(port)] };
}

function clientRoot(): string {
    return app.isPackaged ? join(process.resourcesPath, 'client') : join(repoRoot, 'apps', 'client', 'dist');
}

const MISSING_DAEMON = 'The background service is missing. Run the desktop app from the repository or install a release.';

/* A child that ends with the app, used in development or when the service fails to start. */
function spawnDaemon(onExit: () => void): void {
    const target = daemonCommand();
    if (!target) {
        throw new Error(MISSING_DAEMON);
    }
    const env = { ...process.env };
    if (app.isPackaged) {
        const path = loginShellPath();
        if (path) {
            env.PATH = path;
            process.env.PATH = path;
        }
    }
    env.RUIMTE_HOME = ruimteHome;
    // A packaged app has no terminal; the daemon's output goes to the app's log directory instead.
    let stdio: 'inherit' | ['ignore', number, number] = 'inherit';
    if (app.isPackaged) {
        const logs = app.getPath('logs');
        mkdirSync(logs, { recursive: true });
        const log = openSync(join(logs, 'daemon.log'), 'a');
        stdio = ['ignore', log, log];
    }
    daemon = spawn(target.command, target.args, { stdio, env });
    daemon.on('error', (e) => {
        dialog.showErrorBox('Ruimte', `The background service could not start: ${e.message}`);
        app.quit();
    });
    daemon.on('exit', (code) => {
        daemon = null;
        if (!app.isPackaged && code !== 0 && code !== null) {
            console.error(`The daemon exited with code ${code}`);
        }
        onExit();
    });
}

/* One ask of the port, bounded, so a daemon that hangs is no answer rather than a start that never ends. */
async function probeDaemon(): Promise<BuildIdentity | null> {
    try {
        const response = await fetch(`http://127.0.0.1:${port}${MACHINE_HEALTH_PATH}`, { signal: AbortSignal.timeout(1000) });
        return response.ok ? buildIdentityOf(await response.json()) : null;
    } catch {
        return null;
    }
}

// Read on every ask: the daemon mints it on its first start, which under `bun dev` may come after this window.
async function readLocalSecret(): Promise<string | null> {
    try {
        return (await readFile(join(ruimteHome, 'local.key'), 'utf8')).trim() || null;
    } catch {
        return null;
    }
}

const daemonPort: DaemonPort = {
    port,
    readSecret: readLocalSecret,
    fetch: (url, init) => fetch(url, init),
    nonce: () => randomBytes(32).toString('base64url')
};

/* Asked before restarting a daemon of an earlier build, which cannot prove it holds the local secret. No window exists yet. */
async function askRestartUnproven(): Promise<boolean> {
    const { response } = await dialog.showMessageBox({
        type: 'question',
        buttons: ['Restart Now', 'Quit'],
        defaultId: 1,
        cancelId: 1,
        message: 'Ruimte was updated, and this machine still runs the previous version.',
        detail: 'That version cannot prove to Ruimte that it belongs to you, so Ruimte connects only after a restart, which ends the terminals and agents running on it. If you quit instead, the machine restarts itself as soon as nothing runs on it.'
    });
    return response === 0;
}

/* Long enough for a daemon that is snapshotting its sessions on the way out of a restart. */
async function waitForDaemon(accept: (health: BuildIdentity) => boolean): Promise<void> {
    const deadline = Date.now() + 20_000;
    while (Date.now() < deadline) {
        const health = await probeDaemon();
        if (health && accept(health)) {
            return;
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('The background service did not come up');
}

/* The id `apps/server/scripts/compile.ts` wrote beside the binary this bundle carries. */
function bundledBuild(): string | null {
    if (!app.isPackaged) {
        return null;
    }
    try {
        return readFileSync(join(process.resourcesPath, 'bin', 'ruimte.build'), 'utf8').trim() || null;
    } catch {
        return null;
    }
}

const support = serviceSupport({ packaged: app.isPackaged, platform: process.platform, appImage: process.env.APPIMAGE });

// The dev app never touches launchd or systemd, whatever it is asked.
function createServiceManager(): ServiceManager | null {
    return support === 'supported' ? platformServiceManager(process.platform) : null;
}

function serviceDefinition(): string {
    const target = daemonCommand();
    if (!target) {
        throw new Error(MISSING_DAEMON);
    }
    const spec = daemonServiceSpec({
        program: target.command,
        args: target.args,
        home: homedir(),
        ruimteHome,
        // A packaged app inherits the launcher's PATH, which is not the one a terminal of this person finds.
        path: loginShellPath() ?? process.env.PATH ?? '/usr/bin:/bin'
    });
    return definitionFor(process.platform, spec);
}

const serviceController = createServiceController({
    support,
    manager: createServiceManager(),
    setting: keepRunningSetting(join(app.getPath('userData'), 'background-service.json'), support),
    definition: serviceDefinition,
    commandLineProgram: commandLineServiceProgram(ruimteHome),
    expected: { version: app.getVersion(), build: bundledBuild() },
    probe: probeDaemon,
    work: () => askDaemonWork(daemonPort),
    verify: () => proveDaemon(daemonPort),
    askRestart: askRestartUnproven,
    waitForHealth: waitForDaemon,
    spawnDaemon,
    killDaemon: () => daemon?.kill('SIGTERM'),
    now: () => Date.now(),
    after: (ms, run) => void setTimeout(run, ms),
    publish: (state) => void pushServiceState(state)
});

function pushServiceState(state: BackgroundServiceState): BackgroundServiceState {
    windows.send('service:state', state);
    return state;
}

/* Set by "Stop the machine", which is a quit that takes the service down with it. */
let stopMachineOnQuit = false;

function stopMachine(): void {
    stopMachineOnQuit = true;
    app.quit();
}

handleFromApp('service:state', () => serviceController.state());
handleFromApp('service:set-keep-running', (_event, keepRunning: boolean) => pushServiceState(serviceController.setKeepRunning(keepRunning === true)));
handleFromApp('service:enable-linger', () => pushServiceState(serviceController.enableLinger()));
/*
 * While an older build or an older definition keeps the machine, the port is asked now and then, so
 * the question and the row in the settings go away once the daemon restarted onto the new one.
 */
function watchPendingRestart(): void {
    if (!serviceController.unsettled()) {
        return;
    }
    const timer = setInterval(() => {
        void serviceController.refresh().then((state) => {
            if (!serviceController.unsettled()) {
                clearInterval(timer);
                pushServiceState(state);
            }
        });
    }, 30_000);
}

handleFromApp('service:restart-now', async () => pushServiceState(await serviceController.restartNow()));
handleFromApp('service:restart-when-idle', () => pushServiceState(serviceController.restartWhenIdle()));
onFromApp('service:stop-machine', () => stopMachine());

// The band the client reserves across the sidebar's strip and the toolbar, which the overlay controls share on Windows and Linux.
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
    overlay: { height: TITLEBAR_HEIGHT, colors: OVERLAY_COLORS }
});

let browserRoutes: ReturnType<typeof installBrowserRoutes>;

function isBrowserGuest(contents: Electron.WebContents): boolean {
    return contents.getType() === 'webview' && contents.session === session.fromPartition(BROWSER_PARTITION);
}

const LOCAL_SCHEMES = ['file:', 'data:', 'blob:', 'about:'];

/* A previewed file may load adjacent assets, but cannot use its scripts to reach a server or, without a press of the person, the system browser. */
function sealPreviewSession(): void {
    const preview = session.fromPartition(PREVIEW_PARTITION);
    preview.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !LOCAL_SCHEMES.some((scheme) => details.url.startsWith(scheme)) }));
    preview.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
}

function isPreviewGuest(contents: Electron.WebContents): boolean {
    return contents.getType() === 'webview' && contents.session === session.fromPartition(PREVIEW_PARTITION);
}

/* Network links a person clicks leave the sealed preview instead of failing silently inside it. */
function routePreviewLinks(contents: Electron.WebContents): void {
    const gesture = createGestureGate(() => Date.now());
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
    if (request === null) {
        keepAwakeRequests.delete(windowId);
    } else {
        keepAwakeRequests.set(windowId, request);
    }
    applyKeepAwake();
}

onFromApp('power:keep-awake', (event, keep: boolean) => {
    const window = senderWindow(event);
    if (window) {
        setKeepAwake(window.id, keep === true ? LEGACY_KEEP_AWAKE : null);
    }
});
onFromApp('power:keep-awake-request', (event, request: unknown) => {
    const window = senderWindow(event);
    if (window) {
        setKeepAwake(window.id, keepAwakeRequestFrom(request));
    }
});

// By window id. The shell counts nothing itself, so the badge and the quit dialog agree with the toolbar.
const agentActivities = new Map<number, AgentActivity>();
let agentActivity: AgentActivity = { working: 0, attention: 0 };

function setAgentActivity(windowId: number, activity: AgentActivity | null): void {
    if (activity === null) {
        agentActivities.delete(windowId);
    } else {
        agentActivities.set(windowId, activity);
    }
    agentActivity = totalActivity(agentActivities.values());
    // A dock badge is macOS and Linux; Windows has none and Electron's call does nothing there.
    if (process.platform !== 'win32') {
        app.setBadgeCount(agentActivity.attention);
    }
}

onFromApp('agents:activity', (event, activity: AgentActivity) => {
    const window = senderWindow(event);
    if (window) {
        setAgentActivity(window.id, typeof activity === 'object' && activity !== null ? activity : null);
    }
});

/* A window that closes or reloads takes what it asked for with it; its page asks again once it is back. */
function dropWindowShares(windowId: number): void {
    setKeepAwake(windowId, null);
    setAgentActivity(windowId, null);
}

/* Set once a person has said to quit with work still running, so the question is asked once. */
let quitConfirmed = false;
let interfaceLanguage: string | null = null;
onFromApp('app:language', (_event, language: unknown) => {
    if (language === 'en' || language === 'nl') {
        interfaceLanguage = language;
    }
});
/* While the question is out, another quit waits for its answer. */
let quitAsked = false;

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
    const survives = serviceController.survivesQuit(stopMachineOnQuit);
    const question = quitQuestion({
        language: interfaceLanguage ?? app.getPreferredSystemLanguages()[0],
        survives,
        windows: agentActivity,
        machine: survives ? null : await askDaemonWork(daemonPort)
    });
    if (question === null) {
        return true;
    }
    const parent = windows.focused();
    const { response } = parent ? await dialog.showMessageBox(parent, question) : await dialog.showMessageBox(question);
    return response === 0;
}

const pageKeys = createPageKeys();

const windowState = createWindowState({
    storage: fileStorage(join(app.getPath('userData'), 'window-state.json')),
    displays: () => screen.getAllDisplays(),
    defaults: { width: 1440, height: 900 }
});

// By window id; the one in front is drawn.
const menuTemplates = new Map<number, Electron.MenuItemConstructorOptions[]>();

// `windows.open` calls `createWindow` in the same tick, which takes this.
let openingView: string | null = null;

function createWindow(
    key: string | null,
    bounds: Partial<Electron.Rectangle> & { width: number; height: number },
    origin: WindowOrigin
): Electron.BrowserWindow {
    const view = openingView;
    openingView = null;
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
                // Under `bun dev` the page reaches its machine through Vite's proxy on its own origin instead.
                ...(devUrl ? [] : [`--ruimte-daemon-url=${daemonUrl}`])
            ]
        }
    });
    const id = window.id;
    const contents = window.webContents;
    window.once('ready-to-show', () => window.show());
    contents.on('before-input-event', (_event, input) => pageKeys.saw(input));
    window.on('closed', () => {
        menuTemplates.delete(id);
        dropWindowShares(id);
        // The last window took the page that answers the menu with it, and Quit still has to be there.
        if (windows.all().every((other) => other === window)) {
            setStaticMenu();
        }
    });
    // Reset client-owned state on main-frame reload; subframe loads must not release the power block.
    contents.on('did-start-loading', () => {
        if (!contents.isLoadingMainFrame()) {
            return;
        }
        dropWindowShares(id);
        menuTemplates.delete(id);
        if (windows.focused() === window) {
            setStaticMenu();
        }
    });
    // Without a page nobody answers a command, but Quit still has to be there.
    contents.on('render-process-gone', () => {
        menuTemplates.delete(id);
        if (windows.focused() === window) {
            setStaticMenu();
        }
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
    void window.loadURL(windowUrl(scheme.url, key, origin === 'first' || smoke, view)).catch(() => undefined);
    return window;
}

const windows = createWindows({
    state: windowState,
    // Where the one window stood before there were several.
    formerKey: 'main',
    session: fileStorage(join(app.getPath('userData'), 'window-session.json')),
    create: createWindow,
    onFront: (window) => applyMenuOf(window)
});

// Audio for the app's own pages only. Set once on the shared session: a handler per window would leave only the last one able to ask.
function sealAppSession(): void {
    const own = session.defaultSession;
    own.setPermissionCheckHandler((requester, permission, _origin, details) => {
        if (permission !== 'media') {
            return true;
        }
        return requester !== null && windows.fromPage(requester) !== null && details.isMainFrame && details.mediaType === 'audio';
    });
    own.setPermissionRequestHandler((requester, permission, callback, details) => {
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
onFromApp('browser:context-action', (_event, request: BrowserContextAction) => {
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

handleFromApp('dialog:pick-folder', async (event, initialPath?: string) => {
    const window = senderWindow(event);
    if (!window) {
        return null;
    }
    const result = await dialog.showOpenDialog(window, {
        properties: ['openDirectory', 'createDirectory'],
        ...(initialPath ? { defaultPath: initialPath } : {})
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
});

handleFromApp('dialog:save-file', async (event, suggestedName: string, bytes: Uint8Array, mime: string) => {
    const window = senderWindow(event);
    if (!window) {
        return null;
    }
    const extension = suggestedName.split('.').pop() ?? '';
    const result = await dialog.showSaveDialog(window, {
        defaultPath: suggestedName,
        ...(extension ? { filters: [{ name: mime, extensions: [extension] }] } : {})
    });
    if (result.canceled || !result.filePath) {
        return null;
    }
    await writeFile(result.filePath, Buffer.from(bytes));
    return result.filePath;
});

const openedImagesFolder = join(app.getPath('temp'), `ruimte-images-${process.pid}-${randomBytes(8).toString('hex')}`);
app.on('will-quit', () => void rm(openedImagesFolder, { recursive: true, force: true }).catch(() => undefined));
handleFromApp('image:open', async (_event, suggestedName: string, bytes: Uint8Array, mime: string) => {
    await openImageCopy(openedImagesFolder, suggestedName, bytes, mime, (path) => shell.openPath(path));
});

/* Where a database export goes. Only the path comes back: the machine writes the file, and only for a page on this computer. */
handleFromApp('dialog:choose-save-path', async (event, request: unknown) => {
    const { suggestedName, extension } = parseSavePathRequest(request);
    const window = senderWindow(event);
    if (!window) {
        return null;
    }
    const result = await dialog.showSaveDialog(window, {
        defaultPath: suggestedName,
        filters: [
            { name: extension.toUpperCase(), extensions: [extension] },
            { name: allFilesLabel(interfaceLanguage ?? undefined), extensions: ['*'] }
        ]
    });
    return result.canceled || !result.filePath ? null : result.filePath;
});

/* A file to import, a SQLite database or an SSH key. Only the path comes back; nothing is read here. */
handleFromApp('dialog:choose-open-path', async (event, request: unknown) => {
    const plan = openDialogPlan(parseOpenPathRequest(request), app.getPath('home'), allFilesLabel(interfaceLanguage ?? undefined));
    const window = senderWindow(event);
    if (!window) {
        return null;
    }
    const result = await dialog.showOpenDialog(window, {
        properties: plan.showHiddenFiles ? ['openFile', 'showHiddenFiles'] : ['openFile'],
        filters: plan.filters,
        ...(plan.defaultPath === undefined ? {} : { defaultPath: plan.defaultPath })
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
});

handleFromApp('shell:open-external', async (_event, url: string) => {
    if (isWebLink(url)) {
        await shell.openExternal(url);
    }
});

handleFromApp('shell:open-system-settings', async (_event, url: string) => {
    if (process.platform === 'darwin' && isSystemSettingsPane(url)) {
        await shell.openExternal(url);
    }
});

// One path that is relative or gone refuses the whole copy.
handleFromApp('clipboard:copy-files', async (_event, requested: unknown) => {
    const paths = copyablePaths(requested);
    const contents = paths === null ? null : fileClipboard(process.platform, paths);
    if (paths === null || contents === null || !paths.every((path) => existsSync(path))) {
        return false;
    }
    const formats = Object.entries(contents.formats).map(([format, value]) => [osClipboardFormat(format), new Blob([value])] as const);
    await clipboard.write([new ClipboardItem({ 'text/plain': contents.text, ...Object.fromEntries(formats) })]);
    return true;
});

onFromApp('devtools:guest', (_event, id: number) => guestDevTools(id));

// For an agent that asked what the page it drives looks like. A guest's own preload has none of this.
handleFromApp('browser:capture', async (_event, id: number) => {
    const guest = webContents.fromId(id);
    if (!guest) {
        return null;
    }
    const image = await guest.capturePage();
    return image.toPNG();
});

/* Only the app's own page gets the local secret, and only once the daemon on the port proved it holds it (`serviceController.start`). */
handleFromApp('daemon:local-secret', () => readLocalSecret());

/*
 * The page runs the login (PKCE, state, start URL); this side listens on loopback for the redirect and
 * holds the refresh token and the session key, encrypted with the OS keychain. The page only gets access tokens.
 */
const addressBookUrl = process.env.RUIMTE_PULSAR_URL ?? ADDRESS_BOOK_URL;
let pulsarVault: SessionVault | null = null;
let pendingLogin: LoopbackLogin | null = null;

function pulsarSessions(): SessionVault {
    pulsarVault ??= new SessionVault({
        client: new AddressBookClient({ baseUrl: addressBookUrl, fetch: (input, init) => net.fetch(input, init) }),
        store: fileSessionStore(join(app.getPath('userData'), 'pulsar-session.bin'), safeStorage),
        signer: fileSessionKey(join(app.getPath('userData'), 'pulsar-key.bin'), safeStorage)
    });
    return pulsarVault;
}

type OpenAiCredentialStatus = {
    configured: boolean;
    persistent: boolean;
};

let openAiKeyStore: SecretStore | null = null;

function openAiKeys(): SecretStore {
    openAiKeyStore ??= fileSecretStore(join(app.getPath('userData'), 'openai-api-key.bin'), safeStorage);
    return openAiKeyStore;
}

async function openAiCredentialStatus(): Promise<OpenAiCredentialStatus> {
    const store = openAiKeys();
    if ((await store.read()) !== null) {
        return { configured: true, persistent: store.persistent() };
    }
    return { configured: false, persistent: false };
}

handleFromApp('openai:credential-status', () => openAiCredentialStatus());

// One file per key. Kept so a store without encryption still holds its secrets in memory until the app quits.
const databaseSecretStores = new Map<string, SecretStore>();

function databaseSecrets(key: string): SecretStore {
    const path = databaseSecretFile(join(app.getPath('userData'), 'database-secrets'), key);
    let store = databaseSecretStores.get(path);
    if (store === undefined) {
        // A password the keychain no longer opens is said, or a person only sees the server turn the login down.
        store = fileSecretStore(path, safeStorage, { reportUnreadable: true });
        databaseSecretStores.set(path, store);
    }
    return store;
}

handleFromApp('database:secret-read', (_event, key: unknown) => databaseSecrets(parseSecretKey(key)).read());

handleFromApp('database:secret-write', (_event, key: unknown, secret: unknown) => databaseSecrets(parseSecretKey(key)).write(parseSecret(secret)));

handleFromApp('database:secret-persistent', () => safeStorage.isEncryptionAvailable());

handleFromApp('openai:save-api-key', async (_event, apiKey: unknown) => {
    if (typeof apiKey !== 'string' || apiKey.trim() === '') {
        throw new Error('Enter an API key');
    }
    await openAiKeys().write(apiKey.trim());
    return openAiCredentialStatus();
});

handleFromApp('openai:clear-api-key', async () => {
    await openAiKeys().write(null);
    return openAiCredentialStatus();
});

handleFromApp('openai:create-live-session', async (_event, sdp: unknown, preferences: unknown) => {
    if (typeof sdp !== 'string') {
        throw new Error('The microphone session offer is invalid');
    }
    const requested = parseOpenAiLivePreferences(preferences);
    if (!requested) {
        throw new Error('The GPT-Live voice settings are invalid');
    }
    const apiKey = await openAiKeys().read();
    if (apiKey === null) {
        throw new Error('Add an OpenAI API key in Settings first');
    }
    return createOpenAiLiveSession((input, init) => net.fetch(input, init), apiKey, sdp, requested);
});

const speechHelper = speechHelperPath(app.isPackaged, join(process.resourcesPath, 'bin', 'ruimte'), repoRoot);
const speechModel = new SpeechModel(
    ruimteHome,
    speechHelper,
    (state) => windows.send('speech:state', state),
    (input, init) => net.fetch(input instanceof URL ? input.toString() : input, init)
);
/* A run's words go back to the page that started it. There is one helper, so one run at a time. */
const speechService = new SpeechService<Electron.WebContents>(speechHelper, speechModel.directory, speechModel.cacheDirectory, (event, owner) => {
    if (owner && !owner.isDestroyed()) {
        owner.send('speech:event', event);
    }
});
app.on('before-quit', () => {
    speechService.dispose();
    speechModel.dispose();
});
app.on('web-contents-created', (_event, contents) => {
    contents.on('render-process-gone', () => {
        if (contents === speechService.owner) {
            speechService.dispose();
        }
    });
    contents.on('did-start-navigation', (_event, _url, _inPlace, isMainFrame) => {
        if (isMainFrame && contents === speechService.owner) {
            speechService.dispose();
        }
    });
    contents.on('destroyed', () => {
        if (contents === speechService.owner) {
            speechService.dispose();
        }
    });
});
handleFromApp('speech:state', async () => {
    await speechModel.initialized;
    return speechModel.state;
});
handleFromApp('speech:enable', async (_event, enabled: unknown) => {
    if (typeof enabled !== 'boolean') {
        throw new Error('Invalid speech setting');
    }
    const state = await speechModel.setEnabled(enabled);
    if (!enabled) {
        speechService.dispose();
    }
    return state;
});
handleFromApp('speech:remove', async () => {
    await speechModel.setEnabled(false);
    speechService.dispose();
    return speechModel.remove();
});
handleFromApp('speech:start', async (event, id: unknown, language: unknown) => {
    await speechModel.initialized;
    if (!speechModel.state.enabled || speechModel.state.phase !== 'ready') {
        throw new Error('Enable speech to text in Settings first');
    }
    if (typeof id !== 'string' || typeof language !== 'string') {
        throw new Error('Invalid dictation request');
    }
    return speechService.start(id, language, event.sender);
});
function dictationId(id: unknown): string {
    if (typeof id !== 'string') {
        throw new Error('Invalid dictation request');
    }
    return id;
}

handleFromApp('speech:samples', async (_event, id: unknown, samples: unknown) => speechService.samples(dictationId(id), samples));
handleFromApp('speech:stop', async (_event, id: unknown) => speechService.stop(dictationId(id)));
handleFromApp('speech:cancel', (_event, id: unknown) => speechService.cancel(dictationId(id)));

// The window that takes the microphone ends what listens in every other one, its dictation run included.
onFromApp('microphone:claim', (event) => {
    if (speechService.owner !== undefined && speechService.owner !== event.sender) {
        speechService.dispose();
    }
    for (const window of windows.all()) {
        if (!window.isDestroyed() && window.webContents !== event.sender) {
            window.webContents.send('microphone:claimed');
        }
    }
});

handleFromApp('media:request-microphone', async () => {
    if (process.platform !== 'darwin') {
        return true;
    }
    const status = systemPreferences.getMediaAccessStatus('microphone');
    if (status === 'granted') {
        return true;
    }
    return status === 'not-determined' ? systemPreferences.askForMediaAccess('microphone') : false;
});

handleFromApp('pulsar:address-book', () => addressBookUrl);

handleFromApp('pulsar:login-listen', async () => {
    // One login at a time: a second click starts over rather than leaving a port open for the first.
    pendingLogin?.cancel();
    pendingLogin = await listenForLogin();
    return { redirectUri: pendingLogin.redirectUri };
});

handleFromApp('pulsar:login-callback', async (event) => {
    const login = pendingLogin;
    if (!login) {
        throw new Error('No sign-in is waiting');
    }
    try {
        const callback = await login.callback;
        // The login ended in the system browser, which keeps the focus while the answer lands in the window that asked.
        const window = senderWindow(event);
        if (window) {
            if (window.isMinimized()) {
                window.restore();
            }
            window.show();
            if (process.platform === 'darwin') {
                app.focus({ steal: true });
            }
            window.focus();
        }
        return callback;
    } finally {
        if (pendingLogin === login) {
            pendingLogin = null;
        }
    }
});

handleFromApp('pulsar:login-cancel', () => {
    pendingLogin?.cancel();
    pendingLogin = null;
});

handleFromApp('pulsar:exchange', (_event, payload: unknown) => pulsarSessions().exchange(SessionLoginCodeSchema.parse(payload)));
handleFromApp('pulsar:refresh', () => pulsarSessions().refresh());
handleFromApp('pulsar:restore', () => pulsarSessions().restore());
handleFromApp('pulsar:sign-out', () => pulsarSessions().signOut());

handleFromApp('window:is-fullscreen', (event) => senderWindow(event)?.isFullScreen() ?? false);

/*
 * A project is in one window at a time: when another window has it, that one comes to the front and
 * the page stays where it was. Null lets the window's project go.
 */
handleFromApp('window:claim', (event, key: unknown) => {
    const window = senderWindow(event);
    return window !== null && (key === null || isWindowKey(key)) && windows.claim(window, key);
});

// Null opens the start screen. A view goes in a new window's address, or as a message to one that already shows the project.
onFromApp('window:open', (_event, key: unknown, view: unknown) => {
    if (key !== null && !isWindowKey(key)) {
        return;
    }
    const shown = key !== null && isWindowView(view) ? view : null;
    const holder = key === null ? null : (windows.all().find((window) => windows.keyOf(window) === key) ?? null);
    if (holder !== null) {
        windows.open(key);
        if (shown !== null) {
            holder.webContents.send('window:show-view', shown);
        }
        return;
    }
    openingView = shown;
    try {
        windows.open(key);
    } finally {
        openingView = null;
    }
});

// Handed over in one tick, so nobody ever holds the project; the asking page goes to the start screen on true.
handleFromApp('window:move-to-new', (event) => {
    const window = senderWindow(event);
    return window !== null && windows.move(window) !== null;
});

onFromApp('window:theme', (_event, state: ThemeState) => theme.apply(state));

// A state machine the client watches, not a dialog that interrupts.
const updater = createUpdater({
    currentVersion: app.getVersion(),
    packaged: app.isPackaged,
    load: () => (require('electron-updater') as typeof import('electron-updater')).autoUpdater,
    publish: (state) => windows.send('update:state', state),
    // Installing closes every window before the app's own before-quit, and the next start opens them again.
    onQuit: (quitting) => (quitting ? windows.quit() : windows.resume()),
    // Refreshed with the check, so the notes of a version it finds are on disk before anyone asks.
    beforeCheck: () => void releaseNotes.list(true)
});

handleFromApp('update:state', () => updater.state());

handleFromApp('update:configure', (_event, autoDownload: unknown) => updater.configure(autoDownload));

handleFromApp('update:check', () => updater.check());

handleFromApp('update:download', () => updater.download());

/*
 * Installing closes every window before it quits, so a quit that ends work is asked about while they
 * are still there. Not when `confirmed`: a person asked from another client after being told what ends.
 */
async function installUpdate(confirmed: boolean): Promise<void> {
    if (!confirmed && !serviceController.survivesQuit(false) && !(await askBeforeQuit())) {
        return;
    }
    quitConfirmed = true;
    if (!updater.install()) {
        quitConfirmed = false;
    }
}

onFromApp('update:install', (_event, confirmed: unknown) => void installUpdate(confirmed === true));

/* From the REST API: the updater's atom feed carries rendered HTML, only the versions up to the next one,
   and tags whose release is still a draft. */
const releaseNotes = createReleaseNotes({
    fetch: (url, init) => net.fetch(url, init),
    cacheFile: join(app.getPath('userData'), 'release-notes.json')
});

handleFromApp('releases:list', (_event, refresh?: boolean) => releaseNotes.list(refresh === true));

// What stands until the page sends its own menu, and again after a reload or a crash.
function setStaticMenu(): void {
    const openSettings = (section: string | null): void => {
        const window = windows.focused();
        window?.show();
        window?.webContents.send('menu:settings', section);
    };
    // Only where a service can run: anywhere else quitting already stops the machine.
    const quitItems: Electron.MenuItemConstructorOptions[] =
        support === 'supported' ? [{ label: 'Stop the Machine and Quit', click: () => stopMachine() }] : [];
    const template = staticMenuTemplate({
        appName: app.name,
        // Replace macOS's stock About and Settings with client routes.
        appItems: [
            { label: `About ${app.name}…`, click: () => openSettings('about') },
            { type: 'separator' },
            { label: 'Settings…', accelerator: 'CommandOrControl+,', click: () => openSettings(null) }
        ],
        quitItems,
        toggleDevTools: () => windows.focused()?.webContents.toggleDevTools()
    });
    Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

/* A page in a browser node or an HTML preview never sees the key, so there the menu answers. */
const runMenuCommand = createMenuCommands({
    pageKeys,
    window: () => windows.focused(),
    keyBypassesPage: () => {
        const focused = webContents.getFocusedWebContents();
        return focused !== null && (isBrowserGuest(focused) || isPreviewGuest(focused));
    }
});

function shellMenuItem(action: MenuShellAction, label: string): Electron.MenuItemConstructorOptions | null {
    if (action === 'devtools') {
        return { label, accelerator: devToolsAccelerator(), click: () => windows.focused()?.webContents.toggleDevTools() };
    }
    // Only where a service can run: anywhere else quitting already stops the machine.
    return action === 'stop-machine-and-quit' && support === 'supported' ? { label, click: () => stopMachine() } : null;
}

function applyMenuOf(window: Electron.BrowserWindow): void {
    const template = menuTemplates.get(window.id);
    if (!template) {
        setStaticMenu();
        return;
    }
    try {
        Menu.setApplicationMenu(Menu.buildFromTemplate(template));
    } catch (error) {
        console.error('[ruimte] menu refused', error);
    }
}

// Every page builds the menu from what has the focus in it (`apps/client/src/shell/menu`); the shell draws the one in front.
onFromApp('menu:set', (event, spec: MenuSpec) => {
    const window = senderWindow(event);
    const template = menuTemplateOf(spec, { run: runMenuCommand, shellItem: shellMenuItem });
    if (!window || !template) {
        return;
    }
    menuTemplates.set(window.id, template);
    if (windows.focused() === window) {
        applyMenuOf(window);
    }
});

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
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
        if (!isBrowserGuest(contents)) {
            return;
        }
        contents.on('context-menu', (_e, params) => guestContextMenu(contents, params, 'browser'));
    });

    windows.attach(app);

    void app.whenReady().then(async () => {
        setStaticMenu();
        protocol.handle(scheme.scheme, (request) => answerAppRequest(scheme, request));
        sealAppSession();
        sealPreviewSession();
        browserRoutes = installBrowserRoutes(fromAppWindow, join(here, 'guest.cjs'));
        powerMonitor.on('on-battery', applyKeepAwake);
        powerMonitor.on('on-ac', applyKeepAwake);
        try {
            // `bun dev` runs the daemon itself; the shell only opens the dev URL.
            if (!devUrl && !(await serviceController.start())) {
                app.quit();
                return;
            }
        } catch (e) {
            dialog.showErrorBox('Ruimte', e instanceof Error ? e.message : 'The background service did not start');
            app.quit();
            return;
        }
        if (smoke) {
            // One window on what the page remembers, whatever the last session left open.
            const window = windows.open(null);
            await new Promise<void>((resolve) => window.webContents.once('did-finish-load', () => resolve()));
            await runSmoke(window, {
                appUrl: scheme.url,
                capturePath,
                titleBarHeight: TITLEBAR_HEIGHT,
                scaleFactorOf: (shown) => screen.getDisplayMatching(shown.getBounds()).scaleFactor
            });
            app.quit();
            return;
        }
        const closeStorageMove = devUrl ? () => undefined : await moveLegacyStorage(port, join(app.getPath('userData'), 'storage-moved-to-app-scheme'));
        windows.restore();
        closeStorageMove();
        updater.start();
        watchPendingRestart();
    });

    app.on('before-quit', (event) => {
        if (!quitConfirmed) {
            event.preventDefault();
            if (quitAsked) {
                return;
            }
            quitAsked = true;
            void askBeforeQuit()
                .catch(() => true)
                .then((go) => {
                    quitAsked = false;
                    if (go) {
                        quitConfirmed = true;
                        app.quit();
                        return;
                    }
                    stopMachineOnQuit = false;
                    // Off macOS the last window closed on its way to this quit, and it comes back as it was.
                    if (process.platform !== 'darwin' && windows.all().length === 0) {
                        windows.restore();
                    }
                    windows.resume();
                });
            return;
        }
        // From here the quit goes ahead, so the windows it closes stay in the session for the next start.
        windows.quit();
        serviceController.quit(stopMachineOnQuit);
    });
}
