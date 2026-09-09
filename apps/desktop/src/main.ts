import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync } from 'node:fs';
import { join, resolve } from 'node:path';

// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { app, BrowserWindow, dialog, ipcMain, Menu, shell, webContents } = require('electron') as typeof import('electron');

/*
 * The desktop shell: one window, the client inside it, the daemon next to it. Nothing crosses
 * IPC that the WebSocket already carries; only window chrome, native dialogs and guest devtools.
 */

const DEFAULT_PORT = 4210;
// The bundler inlines __dirname as the source path; the app path is where the built files are.
const here = join(app.getAppPath(), 'dist');
const repoRoot = resolve(app.getAppPath(), '..', '..');

// In development `bun dev` already runs the daemon and Vite; the shell just opens the dev URL.
const devUrl = process.env.RUIMTE_DEV_URL ?? null;
const smoke = process.env.RUIMTE_SMOKE === '1';
const port = Number(process.env.RUIMTE_PORT ?? DEFAULT_PORT);

let daemon: ChildProcess | null = null;
let mainWindow: Electron.BrowserWindow | null = null;
const devtoolsWindows = new Map<number, Electron.BrowserWindow>();

/*
 * An app opened from the Dock or a launcher inherits a bare PATH, not the one the person's shell
 * builds in its rc files, and the daemon finds `claude` and friends through PATH. Asking the login
 * shell once is what every packaged Electron app does.
 */
const loginShellPath = (): string | null => {
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
};

/* Where the daemon and the client it serves are: compiled into the app's resources, or the repo when run from a checkout. */
const daemonCommand = (): { command: string; args: string[] } | null => {
    if (app.isPackaged) {
        const bin = join(process.resourcesPath, 'bin');
        return {
            command: join(bin, process.platform === 'win32' ? 'ruimte.exe' : 'ruimte'),
            args: ['--port', String(port), '--serve', join(process.resourcesPath, 'client')]
        };
    }
    const entry = join(repoRoot, 'apps', 'server', 'src', 'main.ts');
    if (!existsSync(entry)) {
        return null;
    }
    return { command: 'bun', args: [entry, '--port', String(port), '--serve', join(repoRoot, 'apps', 'client', 'dist')] };
};

const startDaemon = (): void => {
    if (devUrl) {
        return;
    }
    const target = daemonCommand();
    if (!target) {
        dialog.showErrorBox('Ruimte', 'The daemon is missing. Run the desktop app from the repository or install a release.');
        app.quit();
        return;
    }
    const env = { ...process.env };
    if (app.isPackaged) {
        const path = loginShellPath();
        if (path) {
            env.PATH = path;
            process.env.PATH = path;
        }
    }
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
        dialog.showErrorBox('Ruimte', `The daemon could not start: ${e.message}`);
        app.quit();
    });
    daemon.on('exit', (code) => {
        daemon = null;
        if (!app.isPackaged && code !== 0 && code !== null) {
            console.error(`The daemon exited with code ${code}`);
        }
    });
};

const waitForDaemon = async (): Promise<void> => {
    if (devUrl) {
        return;
    }
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
        try {
            const response = await fetch(`http://127.0.0.1:${port}/health`);
            if (response.ok) {
                return;
            }
        } catch {
            // Not up yet.
        }
        await new Promise((resolve) => setTimeout(resolve, 150));
    }
    throw new Error('The daemon did not come up');
};

// The strip the client reserves at the top of the sidebar, which the overlay controls share on Windows and Linux.
const TITLEBAR_HEIGHT = 48;
const OVERLAY_COLORS = { dark: { color: '#1b1b1f', symbolColor: '#ececf1' }, light: { color: '#ffffff', symbolColor: '#18181b' } };

/* The client draws its own chrome. macOS keeps the traffic lights, inset into the sidebar; elsewhere the window controls overlay the strip. */
const titleBarOptions = (dark: boolean): Electron.BrowserWindowConstructorOptions =>
    process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 16, y: 18 } }
        : { titleBarStyle: 'hidden', titleBarOverlay: { height: TITLEBAR_HEIGHT, ...OVERLAY_COLORS[dark ? 'dark' : 'light'] } };

const createWindow = (): Electron.BrowserWindow => {
    const window = new BrowserWindow({
        width: 1440,
        height: 900,
        minWidth: 800,
        minHeight: 500,
        show: false,
        ...titleBarOptions(true),
        backgroundColor: '#131316',
        webPreferences: {
            preload: join(here, 'preload.cjs'),
            contextIsolation: true,
            nodeIntegration: false,
            webviewTag: true
        }
    });
    window.once('ready-to-show', () => window.show());
    window.on('closed', () => {
        mainWindow = null;
    });
    // In fullscreen macOS hides the traffic lights, so the client can take the room back.
    window.on('enter-full-screen', () => window.webContents.send('window:fullscreen', true));
    window.on('leave-full-screen', () => window.webContents.send('window:fullscreen', false));
    // Links a page opens in a new window go to the system browser, never to another Electron window.
    window.webContents.setWindowOpenHandler(({ url }) => {
        void shell.openExternal(url);
        return { action: 'deny' };
    });
    return window;
};

const guestDevTools = (id: number): void => {
    const guest = webContents.fromId(id);
    if (!guest || !mainWindow) {
        return;
    }
    const existing = devtoolsWindows.get(id);
    if (existing && !existing.isDestroyed()) {
        existing.focus();
        return;
    }
    // A window of our own, kept above everything, so the inspector floats over a fullscreen app.
    const window = new BrowserWindow({ width: 960, height: 640, title: 'Inspector', show: false, backgroundColor: '#1b1b1f' });
    window.setAlwaysOnTop(true, 'floating');
    window.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
    guest.setDevToolsWebContents(window.webContents);
    guest.openDevTools({ mode: 'detach' });
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
};

ipcMain.handle('dialog:pick-folder', async (_event, initialPath?: string) => {
    if (!mainWindow) {
        return null;
    }
    const result = await dialog.showOpenDialog(mainWindow, {
        properties: ['openDirectory', 'createDirectory'],
        ...(initialPath ? { defaultPath: initialPath } : {})
    });
    return result.canceled ? null : (result.filePaths[0] ?? null);
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (/^https?:\/\//.test(url)) {
        await shell.openExternal(url);
    }
});

ipcMain.on('devtools:guest', (_event, id: number) => guestDevTools(id));

ipcMain.handle('window:is-fullscreen', () => mainWindow?.isFullScreen() ?? false);

ipcMain.on('window:theme', (_event, dark: boolean) => {
    // The overlay controls are native; they follow the client's theme by hand.
    if (process.platform !== 'darwin' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitleBarOverlay({ height: TITLEBAR_HEIGHT, ...OVERLAY_COLORS[dark ? 'dark' : 'light'] });
    }
});

const setupUpdates = async (): Promise<void> => {
    // The feed comes from app-update.yml that electron-builder writes into the bundle (GitHub releases); a checkout has none.
    if (!app.isPackaged) {
        return;
    }
    try {
        const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
        autoUpdater.autoDownload = true;
        autoUpdater.on('update-downloaded', () => {
            void dialog
                .showMessageBox({ message: 'An update is ready', detail: 'Ruimte restarts to install it.', buttons: ['Restart', 'Later'], defaultId: 0 })
                .then(({ response }) => {
                    if (response === 0) {
                        autoUpdater.quitAndInstall();
                    }
                });
        });
        await autoUpdater.checkForUpdates();
    } catch (e) {
        // An unsigned build, no network or no release yet: the app stays as it is.
        console.error('Update check failed', e);
    }
};

/* Adds a browser node through the client's own keyboard path, points it at the dev server and waits for the page. */
const runSmoke = async (window: Electron.BrowserWindow): Promise<void> => {
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
    await window.webContents.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', altKey: true, bubbles: true }))`);
    await wait(500);
    const target = devUrl ?? `http://127.0.0.1:${port}/`;
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
};

if (!app.requestSingleInstanceLock()) {
    app.quit();
} else {
    app.on('second-instance', () => {
        if (mainWindow) {
            if (mainWindow.isMinimized()) {
                mainWindow.restore();
            }
            mainWindow.focus();
        }
    });

    void app.whenReady().then(async () => {
        Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'appMenu' }, { role: 'editMenu' }, { role: 'viewMenu' }, { role: 'windowMenu' }]));
        startDaemon();
        try {
            await waitForDaemon();
        } catch (e) {
            dialog.showErrorBox('Ruimte', e instanceof Error ? e.message : 'The daemon did not start');
            app.quit();
            return;
        }
        mainWindow = createWindow();
        await mainWindow.loadURL(devUrl ?? `http://127.0.0.1:${port}/`);
        if (smoke) {
            await runSmoke(mainWindow);
            app.quit();
            return;
        }
        void setupUpdates();
    });

    app.on('activate', () => {
        if (mainWindow === null && app.isReady()) {
            mainWindow = createWindow();
            void mainWindow.loadURL(devUrl ?? `http://127.0.0.1:${port}/`);
        }
    });

    app.on('window-all-closed', () => {
        if (process.platform !== 'darwin') {
            app.quit();
        }
    });

    app.on('before-quit', () => {
        // The daemon belongs to the app here; sessions end with it until the background service of a later phase.
        daemon?.kill('SIGTERM');
    });
}
