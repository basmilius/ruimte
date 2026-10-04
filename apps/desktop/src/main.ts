import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, writeFile } from 'node:fs/promises';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { buildIdentityOf, DESKTOP_APP_ORIGIN, DESKTOP_APP_SCHEME, MACHINE_HEALTH_PATH, type BuildIdentity } from '@ruimte/contracts';
import { registerAppScheme, serveAppScheme } from './app-protocol';
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
} from '@basmilius/desktop-shell';
import type { ThemeState } from '@basmilius/desktop-shell/bridge';
import { type AgentActivity, type BackgroundServiceState, type KeepAwakeRequest, type MenuShellAction, type MenuSpec } from '@ruimte/desktop-bridge';
import { isWindowKey, isWindowView, totalActivity, windowUrl } from './app-windows';
import { AddressBookClient, ADDRESS_BOOK_URL, SessionLoginCodeSchema, SessionVault } from '@ruimte/pulsar';
import { copyablePaths, fileClipboard, osClipboardFormat } from './file-clipboard';
import { editFrameOf, runGuestEdit } from './guest-edit';
import { askDaemonWork, proveDaemon, type DaemonPort } from './daemon-proof';
import { createKeepAwakeHold, keepAwakeBlocker, keepAwakeRequestFrom, LEGACY_KEEP_AWAKE, mergeKeepAwake } from './keep-awake';
import { listenForLogin, type LoopbackLogin } from './pulsar-login';
import { fileSessionKey, fileSessionStore } from './pulsar-store';
import { quitQuestion } from './quit-question';
import { createReleaseNotes } from './release-notes';
import { createServiceController } from './service/controller';
import { commandLineServiceProgram, daemonServiceSpec, platformServiceManager, serviceDefinition as definitionFor, type ServiceManager } from '@ruimte/service';
import { keepRunningSetting, serviceSupport } from './service/settings';
import { fileSecretStore, type SecretStore } from './secret-store';
import { createOpenAiLiveSession, parseOpenAiLivePreferences } from './openai-live';
import { SpeechService, speechHelperPath } from './speech';
import { SpeechModel } from './speech-model';
import {
    allowGuestPermission,
    appSubframeNavigation,
    appWindowNavigation,
    BROWSER_PARTITION,
    createGestureGate,
    hardenGuestPreferences,
    isAppSender,
    isExternalLink,
    isSystemSettingsPane,
    PREVIEW_PARTITION
} from './web-guards';

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
    safeStorage,
    screen,
    session,
    shell,
    systemPreferences,
    webContents
} = require('electron') as typeof import('electron');

/*
 * The desktop shell: a window per project, the client inside each, the daemon next to them. Nothing
 * crosses IPC that the WebSocket already carries; only window chrome, native dialogs and guest devtools.
 */

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
const appUrl = devUrl ?? `${DESKTOP_APP_ORIGIN}/`;
const appOrigin = devUrl ? new URL(devUrl).origin : DESKTOP_APP_ORIGIN;
const APP_SCHEMES = [DESKTOP_APP_SCHEME];
// What the page reaches its own machine at, now that it is not served from there.
const daemonUrl = `http://127.0.0.1:${port}`;

registerAppScheme();

let daemon: ChildProcess | null = null;
const devtoolsWindows = new Map<number, Electron.BrowserWindow>();

/*
 * Every channel answers the app's own pages and nothing else. A guest cannot reach one (its preload
 * only talks to its host), but a page the window was navigated to would inherit the bridge.
 */
function fromAppWindow(event: Electron.IpcMainEvent | Electron.IpcMainInvokeEvent): boolean {
    return isAppSender(windows.fromPage(event.sender) !== null, event.senderFrame, appOrigin, APP_SCHEMES);
}

/* The window whose page a message came from, which is where its dialog, its sheet and its answer belong. */
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
 * An app opened from the Dock or a launcher inherits a bare PATH, not the one the person's shell
 * builds in its rc files, and the daemon finds `claude` and friends through PATH. Asking the login
 * shell once is what every packaged Electron app does.
 */
let loginPath: string | null | undefined;

function loginShellPath(): string | null {
    if (loginPath !== undefined) {
        return loginPath;
    }
    loginPath = askLoginShellPath();
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

/* Where the daemon is: compiled into the app's resources, or the repo when run from a checkout. */
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

/* The built client the shell serves on its scheme: in the app's resources, or the repo's build when run from a checkout. */
function clientRoot(): string {
    return app.isPackaged ? join(process.resourcesPath, 'client') : join(repoRoot, 'apps', 'client', 'dist');
}

const MISSING_DAEMON = 'The background service is missing. Run the desktop app from the repository or install a release.';

/* The app's own daemon, a child that ends with the app: the dev app always, a packaged one with the service off. */
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

/*
 * The daemon's local secret, which is how the app proves it runs on this machine now that a loopback
 * address proves nothing. Read on every ask rather than once: the daemon mints it on its first start,
 * which in `bun dev` may come after this window.
 */
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

/* Only a packaged app on macOS or Linux gets one; the dev app has none to touch, whatever it is asked. */
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
 * The theme the client is in. The client owns it (it may follow the system or not) and reports it,
 * and the shell paints it on the native window controls, the window's own ground and the
 * `prefers-color-scheme` every page inside a webview asks for. The color travels with the message, so
 * `styles.css` stays the one place the token is written down. macOS keeps the traffic lights, inset
 * into the sidebar and lined up with the sidebar toggle; elsewhere the controls overlay the toolbar's right end.
 */
const theme = createTheme({
    nativeTheme,
    windows: () => windows.all(),
    background: '#131316',
    overlay: { height: TITLEBAR_HEIGHT, colors: OVERLAY_COLORS }
});

/*
 * The preload of every browser page (`guest.ts`): the wheel samples a swipe is read from, the side
 * buttons of a mouse and Cmd+[ inside a page, all sent to the webview element. Registered on the
 * session so the client names no path; a main frame runs it and a subframe does not.
 */
function registerGuestPreload(): void {
    session.fromPartition(BROWSER_PARTITION).registerPreloadScript({ type: 'frame', id: 'ruimte-guest', filePath: join(here, 'guest.cjs') });
}

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

function sealBrowserSession(): void {
    const browser = session.fromPartition(BROWSER_PARTITION);
    browser.setPermissionRequestHandler((_contents, permission, callback) => callback(allowGuestPermission(permission)));
    browser.setPermissionCheckHandler((_contents, permission) => allowGuestPermission(permission));
    browser.setDevicePermissionHandler(() => false);
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
        const verdict = appWindowNavigation(event.url, appOrigin, APP_SCHEMES);
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
        const verdict = event.isMainFrame ? appWindowNavigation(event.url, appOrigin, APP_SCHEMES) : appSubframeNavigation(event.url, appOrigin, APP_SCHEMES);
        if (verdict !== 'allow') {
            event.preventDefault();
        }
    });
    // The main frame is `will-navigate`'s, which is the one that may hand a link to the system browser.
    contents.on('will-frame-navigate', (event) => {
        if (!event.isMainFrame && appSubframeNavigation(event.url, appOrigin, APP_SCHEMES) !== 'allow') {
            event.preventDefault();
        }
    });
}

/* What each window last asked for, by window id. Kept rather than applied once, since the power
   source it depends on changes while the request stands. */
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

/*
 * What each window last said about its agents, by window id. The shell counts nothing itself: which
 * node holds an agent and which holds a shell somebody left attached is the client's own question,
 * and asking it twice is how the badge and the quit dialog would end up disagreeing with the toolbar.
 */
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
/* While the question is out, another quit waits for its answer. */
let quitAsked = false;

/*
 * Under `bun dev` the launcher hands down a pipe (`scripts/launch.ts`). When it closes, because the terminal
 * stopped `bun dev` or the launcher died, the app goes with it and skips the question nobody is there to
 * answer. A signal is no way to tell: Chromium takes SIGINT itself and turns the first one into a quit
 * that the question holds up.
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

/*
 * Whether to go ahead with a quit. The machine is asked what runs on it only when the quit ends it,
 * since a window that closed took its own count with it and the last one may be gone already.
 */
async function askBeforeQuit(): Promise<boolean> {
    const survives = serviceController.survivesQuit(stopMachineOnQuit);
    const question = quitQuestion({ survives, windows: agentActivity, machine: survives ? null : await askDaemonWork(daemonPort) });
    if (question === null) {
        return true;
    }
    const parent = windows.focused();
    const { response } = parent ? await dialog.showMessageBox(parent, question) : await dialog.showMessageBox(question);
    return response === 0;
}

const pageKeys = createPageKeys();

/* Every window opens where a person left it, maximized or in full screen included, under what it shows. */
const windowState = createWindowState({
    storage: fileStorage(join(app.getPath('userData'), 'window-state.json')),
    displays: () => screen.getAllDisplays(),
    defaults: { width: 1440, height: 900 }
});

/* The application menu each window's page last sent, by window id. The one in front is the one drawn. */
const menuTemplates = new Map<number, Electron.MenuItemConstructorOptions[]>();

/* The view the window `window:open` is about to make shows first. `windows.open` calls `createWindow` in the same tick, which takes it. */
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
            webviewTag: true,
            // On macOS the first is `NSLocale.currentLocale`, so it follows the Region setting, and
            // the second is the language order from System Settings; `app.getLocale()` would hand
            // back the language of the bundle, which is `en-US` even on a Dutch Mac.
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
    contents.on('will-attach-webview', (event, preferences) => {
        if (!hardenGuestPreferences(preferences)) {
            event.preventDefault();
        }
    });
    // The smoke run opens its one window the way a start without a session does.
    void window.loadURL(windowUrl(appUrl, key, origin === 'first' || smoke, view)).catch(() => undefined);
    return window;
}

/* A window per project, and the windows of the last session again at the next start. */
const windows = createWindows({
    state: windowState,
    // Where the one window stood before there were several.
    formerKey: 'main',
    session: fileStorage(join(app.getPath('userData'), 'window-session.json')),
    create: createWindow,
    onFront: (window) => applyMenuOf(window)
});

/*
 * The microphone is for the app's own pages, and only for audio. Set once on the session every
 * window shares; a handler per window would leave only the last window able to ask.
 */
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

/* Which guest a right-click came from, so the client draws a preview's menu without a page's history. */
type GuestKind = 'browser' | 'preview';

/* What the client may ask the shell to do on a guest page. Mirrors `apps/client/src/desktop/bridge.ts`. */
interface BrowserContextAction {
    webContentsId: number;
    action: string;
    payload?: { url?: string; x?: number; y?: number };
}

/* At most this many of the spellchecker's guesses get a row, so the menu cannot run off the screen. */
const SPELLING_SUGGESTIONS = 5;

/* Where a selection goes when someone asks the system browser to look it up, as in the client's menu. */
const SEARCH_URL = 'https://www.google.com/search?q=';

function menuLabel(text: string): string {
    const line = text.trim().replace(/\s+/g, ' ');
    return line.length > 24 ? `${line.slice(0, 24)}…` : line;
}

/*
 * The menu over an editable field, native on purpose. A text field is the one place where the
 * platform brings more than we can draw: macOS hangs AutoFill, Writing Tools and Services off an
 * AppKit menu, and none of that survives a menu the renderer paints. Standard roles are what the
 * platform recognizes, so every row that has one uses it, and the rows macOS appends itself are
 * not in the template.
 */
function editableGuestMenu(contents: Electron.WebContents, params: Electron.ContextMenuParams, inspectable: boolean): void {
    const template: Electron.MenuItemConstructorOptions[] = [];
    for (const word of params.dictionarySuggestions.slice(0, SPELLING_SUGGESTIONS)) {
        template.push({ label: word, click: () => contents.replaceMisspelling(word) });
    }
    if (template.length > 0) {
        template.push({ type: 'separator' });
    }
    template.push(
        { role: 'undo', enabled: params.editFlags.canUndo },
        { role: 'redo', enabled: params.editFlags.canRedo },
        { type: 'separator' },
        { role: 'cut', enabled: params.editFlags.canCut },
        { role: 'copy', enabled: params.editFlags.canCopy },
        { role: 'paste', enabled: params.editFlags.canPaste }
    );
    // Only a rich field has a style to drop, which is the whole point of the row.
    if (params.editFlags.canEditRichly) {
        template.push({ role: 'pasteAndMatchStyle', enabled: params.editFlags.canPaste });
    }
    template.push({ role: 'delete', enabled: params.editFlags.canDelete }, { role: 'selectAll', enabled: params.editFlags.canSelectAll });
    if (process.platform === 'darwin' && params.selectionText !== '') {
        // Electron has no dictionary or search roles; macOS adds Share and Services through the frame.
        template.push(
            { type: 'separator' },
            { label: `Look Up "${menuLabel(params.selectionText)}"`, click: () => contents.showDefinitionForSelection() },
            { label: 'Search with Google', click: () => void shell.openExternal(`${SEARCH_URL}${encodeURIComponent(params.selectionText)}`) }
        );
    }
    if (inspectable) {
        template.push({ type: 'separator' }, { label: 'Inspect element', click: () => guestDevTools(contents.id, { x: params.x, y: params.y }) });
    }
    /*
     * The frame is the one thing that makes AutoFill appear: without it Electron pops a plain menu
     * and macOS appends none of its own rows (AutoFill, Writing Tools, Services). It is null once
     * the frame navigated away or died, and then the menu still opens, just without those rows.
     * AutoFill here routes to Apple's Passwords app only; Chrome's password manager is not in
     * Electron. No position: the menu belongs at the cursor, which is where Electron puts it.
     */
    Menu.buildFromTemplate(template).popup({ window: windows.fromContents(contents) ?? undefined, ...(params.frame ? { frame: params.frame } : {}) });
}

/* The frame each guest's last right-click landed in, so copy and select all act where the person pointed. */
const menuFrames = new WeakMap<Electron.WebContents, Electron.WebFrameMain>();

/*
 * A right-click inside a browser node's page or an HTML preview. Electron ships no menu for web
 * content (Chromium's own belongs to the Chrome browser) and a native one reads as another
 * program's, so the client draws it: the shell says what the click landed on and nothing more. An
 * editable field is the exception and never leaves the shell, because what the platform adds to a
 * native menu there is worth more than a menu in the app's own style.
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
    // The window the guest's page sits in draws the menu; a guest of no window of ours gets none.
    windows.fromContents(contents)?.webContents.send('browser:context-menu', {
        webContentsId: contents.id,
        guest,
        x: params.x,
        y: params.y,
        linkURL: params.linkURL,
        linkText: params.linkText,
        srcURL: params.srcURL,
        mediaType: params.mediaType,
        isEditable: params.isEditable,
        selectionText: params.selectionText,
        editFlags: {
            canCut: params.editFlags.canCut,
            canCopy: params.editFlags.canCopy,
            canPaste: params.editFlags.canPaste,
            canSelectAll: params.editFlags.canSelectAll
        },
        pageURL: params.pageURL
    });
}

/* A sealed preview only reads: nothing it is asked to do may download, inspect or leave for the system browser. */
const PREVIEW_ACTIONS = new Set(['copy', 'select-all', 'copy-image']);

/*
 * The row the person picked, for the part of it the renderer cannot reach: the guest's own copy, a
 * download, the inspector and the system browser. The editing rows are not here, because an
 * editable field never reaches the client. Only a guest the menu came from takes one.
 */
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

/* Bytes the client made (an exported drawing) go where a native dialog says they go. */
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

handleFromApp('shell:open-external', async (_event, url: string) => {
    if (/^https?:\/\//.test(url)) {
        await shell.openExternal(url);
    }
});

handleFromApp('shell:open-system-settings', async (_event, url: string) => {
    if (process.platform === 'darwin' && isSystemSettingsPane(url)) {
        await shell.openExternal(url);
    }
});

/* Files a person copied from a menu, for the file manager to paste. One path that is relative or gone refuses the whole copy. */
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

/*
 * A png of a guest page, for an agent that asked what the page it drives looks like. Only the app's
 * own page may ask: a guest carries its own preload, which has none of this, and a picture of
 * another guest is not something a page gets to take.
 */
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
 * Signing in to the Pulsar address book. The page runs the login (PKCE, the state, the start URL) and
 * this side does what a page should not: it listens on loopback for the redirect, and it holds the
 * refresh token and the key the session is bound to, both encrypted with the OS keychain in `userData`. The page only ever gets access tokens,
 * which live a quarter of an hour. Every handler answers the app's own window and nothing else.
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
handleFromApp('speech:samples', async (_event, id: unknown, samples: unknown) => {
    if (typeof id !== 'string') {
        throw new Error('Invalid dictation request');
    }
    return speechService.samples(id, samples);
});
handleFromApp('speech:stop', async (_event, id: unknown) => {
    if (typeof id !== 'string') {
        throw new Error('Invalid dictation request');
    }
    return speechService.stop(id);
});
handleFromApp('speech:cancel', (_event, id: unknown) => {
    if (typeof id !== 'string') {
        throw new Error('Invalid dictation request');
    }
    speechService.cancel(id);
});

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
 * What a window shows. A page asks before it shows a project, and a project is in one window at a
 * time: when another window has it, that one comes to the front and the page stays where it was.
 * Null lets the window's project go, as when it goes back to the start screen.
 */
handleFromApp('window:claim', (event, key: unknown) => {
    const window = senderWindow(event);
    return window !== null && (key === null || isWindowKey(key)) && windows.claim(window, key);
});

/*
 * A new window on the start screen (null), or the window of a project, raised when one already has it.
 * A view goes along to the window that shows the project: in the address of a new one, as a message
 * to one that is already there.
 */
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

/*
 * The project of the asking window, into a window of its own. Handed over in one tick, so there is
 * no moment nobody holds it; the page that asked goes to the start screen once this answers true.
 */
handleFromApp('window:move-to-new', (event) => {
    const window = senderWindow(event);
    return window !== null && windows.move(window) !== null;
});

onFromApp('window:theme', (_event, state: ThemeState) => theme.apply(state));

/*
 * The updater is a state machine the client watches, not a dialog that interrupts. Every change is
 * pushed to the window, which draws the green button in the toolbar and About in the settings.
 */
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

/* From the REST API rather than the updater's atom feed: the feed carries GitHub's rendered HTML,
   only the versions between this one and the next, and a tag whose release is still a draft. */
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

/* The menu of the window that came to the front, or the fixed one until its page sent one. */
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

/*
 * Writes the left end of the title bar band to a PNG in device pixels, which is how its geometry
 * gets measured instead of guessed. The traffic lights are native and never show up in a page
 * capture; only what the client draws next to them does.
 */
async function captureTitleBar(window: Electron.BrowserWindow, target: string): Promise<void> {
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 200, height: TITLEBAR_HEIGHT });
    const { scaleFactor } = screen.getDisplayMatching(window.getBounds());
    writeFileSync(target, image.toPNG({ scaleFactor }));
    console.log(`smoke: wrote ${target} at ${scaleFactor}x`);
}

/* Adds a browser node through the client's own keyboard path, points it at the dev server and waits for the page. */
async function runSmoke(window: Electron.BrowserWindow): Promise<void> {
    console.log('smoke: window loaded');
    window.webContents.on('preload-error', (_event, path, error) => console.log(`smoke: preload error in ${path}: ${error.message}`));
    console.log(`smoke: bridge is ${await window.webContents.executeJavaScript('typeof window.ruimteDesktop')}`);
    if ((await window.webContents.executeJavaScript('typeof window.ruimte')) === 'undefined') {
        // A production client has no test hooks; that the daemon served it and the bridge is there is the whole test.
        console.log('smoke: production client, no test hooks to drive a browser node');
        return;
    }
    window.webContents.on('console-message', (event) => {
        if (event.level === 'error') {
            console.log(`smoke: renderer error: ${event.message.slice(0, 200)}`);
        }
    });
    const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
    await wait(1500);
    if (capturePath) {
        await captureTitleBar(window, capturePath);
        return;
    }
    await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', altKey: true, bubbles: true }))`);
    await wait(500);
    const target = appUrl;
    await window.webContents.executeJavaScript(
        `(() => { const ids = window.ruimte?.nodeIds() ?? []; const id = ids[ids.length - 1]; if (id) { window.ruimte.browserNavigate(id, ${JSON.stringify(target)}); } })()`
    );
    for (let attempt = 0; attempt < 40; attempt++) {
        await wait(250);
        const state = (await window.webContents.executeJavaScript(
            `(() => { const ids = window.ruimte?.nodeIds() ?? []; const id = ids[ids.length - 1]; return id ? window.ruimte.browserState(id) : null; })()`
        )) as { url: string; loading: boolean; title: string; error: string | null } | null;
        if (state && !state.loading && state.url.startsWith(target)) {
            console.log(`smoke: browser node loaded ${state.url} (${state.error ?? state.title})`);
            return;
        }
    }
    const detail = await window.webContents.executeJavaScript(
        `(() => { const ids = window.ruimte?.nodeIds() ?? []; const id = ids[ids.length - 1]; const views = [...document.querySelectorAll('webview')]; return JSON.stringify({ ids, state: id ? window.ruimte.browserState(id) : null, views: views.map((v) => ({ src: v.getAttribute('src'), attached: v.isConnected, parent: v.parentElement?.style.visibility })) }); })()`
    );
    console.log(`smoke: the browser node did not finish loading: ${detail}`);
}

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
        serveAppScheme(clientRoot());
        sealAppSession();
        sealPreviewSession();
        sealBrowserSession();
        registerGuestPreload();
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
            await runSmoke(window);
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
