import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
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

/* Until the daemon is compiled into the app (phase 11), it runs from the repo through bun. */
const startDaemon = (): void => {
    if (devUrl) {
        return;
    }
    const clientDist = join(repoRoot, 'apps', 'client', 'dist');
    const entry = join(repoRoot, 'apps', 'server', 'src', 'main.ts');
    if (!existsSync(entry)) {
        dialog.showErrorBox('Ruimte', `The daemon is missing at ${entry}. Run the desktop app from the repository for now.`);
        app.quit();
        return;
    }
    daemon = spawn('bun', [entry, '--port', String(port), '--serve', clientDist], { stdio: 'inherit', env: process.env });
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
    // Unsigned builds cannot verify an update, so this only runs for a packaged, configured app.
    if (!app.isPackaged || !process.env.RUIMTE_UPDATE_URL) {
        return;
    }
    try {
        const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
        autoUpdater.setFeedURL({ provider: 'generic', url: process.env.RUIMTE_UPDATE_URL });
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
        console.error('Update check failed', e);
    }
};

/* Adds a browser node through the client's own keyboard path, points it at the dev server and waits for the page. */
const runSmoke = async (window: Electron.BrowserWindow): Promise<void> => {
    console.log('smoke: window loaded');
    window.webContents.on('preload-error', (_event, path, error) => console.log(`smoke: preload error in ${path}: ${error.message}`));
    console.log(`smoke: bridge is ${await window.webContents.executeJavaScript('typeof window.ruimteDesktop')}`);
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
