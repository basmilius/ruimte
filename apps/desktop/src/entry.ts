import { existsSync } from 'node:fs';
import { Socket } from 'node:net';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { createAppIpc, createPageKeys, createTheme, createWindows, type WindowOrigin, createWindowState, fileStorage } from '@adecore/shell';
import { answerAppRequest, createDesktopAppScheme } from './app-scheme';
import { windowUrl } from './app-windows';
import { installBrowserRoutes } from './browser-routes';
import { askDaemonWork, clearVoiceKey, handVoiceKey } from './daemon-proof';
import { LAUNCHER_PIPE_VARIABLE } from './launcher-pipe';
import { moveLegacyStorage } from './legacy-storage';
import { MACHINE_ARGUMENT } from './machine-argument';
import { decideMachineMode, hasInstallTraces, machineModeFile, parseModeOverride } from './machine-mode';
import { installAgentActivity } from './main/activity';
import { serveDevExtensionFiles } from './main/dev-extension-files';
import { installDialogs } from './main/dialogs';
import { electron } from './main/electron';
import { ClientExtensions, installExtensions } from './main/extensions';
import { installGuests, isBrowserGuest, isPreviewGuest, routePreviewLinks, sealPreviewSession } from './main/guests';
import { installLanguage } from './main/language';
import { installLogin } from './main/login';
import { installMachineMode } from './main/machine-mode';
import { installMenu } from './main/menu';
import { installPower } from './main/power';
import { installQuickLook } from './main/quick-look';
import { installSecrets } from './main/secrets';
import { createMachine } from './main/service';
import { installSpeech } from './main/speech';
import { startTelemetry } from './main/telemetry';
import { installUpdates } from './main/updates';
import { installUsage } from './main/usage';
import { installWindows } from './main/windows';
import { quitQuestion } from './quit-question';
import { runSmoke } from './smoke';
import { installSocketTypeOfServiceGuard } from './socket-tos-guard';
import { startApp } from './startup';
import { allowAppPermission, appSubframeNavigation, isExternalLink } from './web-guards';

const { app, BrowserWindow, dialog, ipcMain, nativeTheme, protocol, screen, session, shell, webContents } = electron;

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

// A change reaches only through IPC, so `windows` is there by the time one is told.
const clientExtensions = new ClientExtensions(join(app.getPath('userData'), 'extensions'), () => windows.send('extensions:changed'));

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

const power = installPower(ipc);
const agentActivity = installAgentActivity(ipc);
const interfaceLanguage = installLanguage(ipc);

/* A window that closes or reloads takes what it asked for with it; its page asks again once it is back. */
function dropWindowShares(windowId: number): void {
    power.drop(windowId);
    agentActivity.drop(windowId);
}

/* Set when a quit needs no question: an install asked before it closed the windows, or the launcher's pipe closed. */
let quitConfirmed = false;
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
async function askBeforeQuit(stopsMachine = machine.stopsOnQuit()): Promise<boolean> {
    const survives = machine.controller.survivesQuit(stopsMachine);
    const question = quitQuestion({
        language: interfaceLanguage.current() ?? app.getPreferredSystemLanguages()[0],
        survives,
        elsewhere: !localMachine,
        windows: agentActivity.total(),
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

function createWindow(
    key: string | null,
    bounds: Partial<Electron.Rectangle> & { width: number; height: number },
    origin: WindowOrigin,
    state: string | null
): Electron.BrowserWindow {
    // `windows.open` calls this in the same tick as the channel that set what it opens with.
    const { view, inactive } = windowChannels.takeOpening();
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
            // Electron leaves the elastic bounce of macOS off unless a window asks; a scroller then bounces at its end.
            scrollBounce: true,
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

// Set once on the shared session: a handler per window would leave only the last one able to ask.
function sealAppSession(): void {
    const own = session.defaultSession;
    own.setPermissionCheckHandler((requester, permission, _origin, details) =>
        allowAppPermission({
            permission,
            appMainFrame: requester !== null && windows.fromPage(requester) !== null && details.isMainFrame,
            mediaTypes: details.mediaType === undefined ? [] : [details.mediaType]
        })
    );
    own.setPermissionRequestHandler((requester, permission, callback, details) => {
        callback(
            allowAppPermission({
                permission,
                appMainFrame: windows.fromPage(requester) !== null && details.isMainFrame,
                mediaTypes: 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
            })
        );
    });
}

const guests = installGuests(ipc, { windowOf: (contents) => windows.fromContents(contents) });
installDialogs(ipc, () => interfaceLanguage.current() ?? undefined);
installExtensions(ipc, clientExtensions);
const secrets = installSecrets(
    ipc,
    localMachine ? { hand: (key) => handVoiceKey(machine.daemonPort, key), clear: () => clearVoiceKey(machine.daemonPort) } : null
);
installSpeech(ipc, { ruimteHome, repoRoot, send: (channel, payload) => windows.send(channel, payload), windows: () => windows.all() });
const login = installLogin(ipc);
const usage = installUsage(ipc, { mode: machineMode, ruimteHome, signedIn: login.signedIn });
if (localMachine && process.platform === 'darwin') {
    installQuickLook(ipc, { ruimteHome, keyOf: (window) => windows.keyOf(window) });
}

const windowChannels = installWindows(ipc, { windows, theme });

const updates = installUpdates(ipc, {
    windows,
    machine,
    askBeforeQuit,
    confirmQuit: (confirmed) => {
        quitConfirmed = confirmed;
    }
});

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

// Chromium bounces a scroller at its end only on macOS by default; Windows and Linux get the same through this feature.
if (process.platform !== 'darwin') {
    app.commandLine.appendSwitch('enable-features', 'ElasticOverscroll');
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
            contents.on('context-menu', (_e, params) => guests.contextMenu(contents, params, 'preview'));
            return;
        }
        if (isBrowserGuest(contents)) {
            contents.on('context-menu', (_e, params) => guests.contextMenu(contents, params, 'browser'));
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
        protocol.handle(scheme.scheme, (request) => answerAppRequest(scheme, request, clientExtensions));
        if (devUrl !== null) {
            serveDevExtensionFiles(devUrl, clientExtensions);
        }
        sealAppSession();
        sealPreviewSession();
        browserRoutes = installBrowserRoutes(fromAppWindow, join(here, 'guest.cjs'));
        power.followPowerSource();
        await startApp({
            localMachine,
            startMachine: () => machine.start(),
            moveStorage: () =>
                devUrl ? Promise.resolve(() => undefined) : moveLegacyStorage(port, join(app.getPath('userData'), 'storage-moved-to-app-scheme')),
            restoreWindows: () => windows.restore(),
            startUpdater: () => updates.start(),
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
