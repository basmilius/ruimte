import { spawn, spawnSync, type ChildProcess } from 'node:child_process';
import { existsSync, mkdirSync, openSync, writeFileSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';

// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { app, BrowserWindow, dialog, ipcMain, Menu, nativeTheme, screen, session, shell, webContents } = require('electron') as typeof import('electron');

/*
 * The desktop shell: one window, the client inside it, the daemon next to it. Nothing crosses
 * IPC that the WebSocket already carries; only window chrome, native dialogs and guest devtools.
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
        dialog.showErrorBox('Ruimte', 'The background service is missing. Run the desktop app from the repository or install a release.');
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
    } else {
        env.RUIMTE_HOME ??= join(homedir(), '.ruimte-dev');
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
        dialog.showErrorBox('Ruimte', `The background service could not start: ${e.message}`);
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
    throw new Error('The background service did not come up');
};

// The band the client reserves across the sidebar's strip and the toolbar, which the overlay controls share on Windows and Linux.
const TITLEBAR_HEIGHT = 48;
const OVERLAY_COLORS = { dark: { color: '#1b1b1f', symbolColor: '#ececf1' }, light: { color: '#ffffff', symbolColor: '#18181b' } };

/* The client draws its own chrome. macOS keeps the traffic lights, inset into the sidebar; elsewhere the window controls overlay the toolbar's right end.
   `trafficLightPosition` is the top left of the buttons' frame, lined up with the sidebar toggle beside it. */
const titleBarOptions = (dark: boolean): Electron.BrowserWindowConstructorOptions =>
    process.platform === 'darwin'
        ? { titleBarStyle: 'hiddenInset', trafficLightPosition: { x: 12, y: 15 } }
        : { titleBarStyle: 'hidden', titleBarOverlay: { height: TITLEBAR_HEIGHT, ...OVERLAY_COLORS[dark ? 'dark' : 'light'] } };

// The partition every browser node's page lives in; `apps/client/src/browser/registry.ts`.
const BROWSER_PARTITION = 'persist:ruimte';

/*
 * The theme the client is in. The client owns it (it may follow the system or not) and reports it,
 * because the shell needs it three times over: for the native window controls, for the window's own
 * ground, and for the `prefers-color-scheme` every page inside a webview asks for, which without
 * this would be the system's answer rather than the app's. The color travels with the message, so
 * `styles.css` stays the one place the token is written down.
 */
interface AppTheme {
    resolved: 'light' | 'dark';
    /* True while the app follows the system, which is the one case a page may follow it too. */
    followsSystem: boolean;
    /* The value of `--bg` in the theme that is up. */
    background: string;
}

const isBrowserGuest = (contents: Electron.WebContents): boolean =>
    contents.getType() === 'webview' && contents.session === session.fromPartition(BROWSER_PARTITION);

const applyTheme = (theme: AppTheme): void => {
    // Chromium answers `prefers-color-scheme` from this, so a page follows the app instead of the
    // system the app happens to run on. 'system' is only right while the app follows it as well.
    nativeTheme.themeSource = theme.followsSystem ? 'system' : theme.resolved;
    // The overlay controls are native; they follow the client's theme by hand.
    if (process.platform !== 'darwin' && mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setTitleBarOverlay({ height: TITLEBAR_HEIGHT, ...OVERLAY_COLORS[theme.resolved] });
    }
    // The window's own ground, so a reload and a resize never flash the other theme's color.
    if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.setBackgroundColor(theme.background);
    }
};

// The partition the file preview in the client's panel loads a page into; `apps/client/src/shell/panels/HtmlFile.tsx`.
const PREVIEW_PARTITION = 'preview';

// A scheme the page carries itself, which never leaves the machine.
const LOCAL_SCHEMES = ['file:', 'data:', 'blob:', 'about:'];

/*
 * A previewed HTML file is a plain local document: it may pull in the assets beside it and nothing
 * else. Without this a script in the file could call the daemon, whose routes ask a loopback caller
 * for no token, and hand what it reads to any host it likes.
 */
const sealPreviewSession = (): void => {
    const preview = session.fromPartition(PREVIEW_PARTITION);
    preview.webRequest.onBeforeRequest((details, callback) => callback({ cancel: !LOCAL_SCHEMES.some((scheme) => details.url.startsWith(scheme)) }));
    preview.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
};

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

/* Opens the inspector for a guest page, on the element under `at` when a point comes with it. */
const guestDevTools = (id: number, at?: { x: number; y: number }): void => {
    const guest = webContents.fromId(id);
    if (!guest || !mainWindow) {
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
};

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

/* A selection reads in a menu label on one line, short enough to take in at a glance. */
const menuLabel = (text: string): string => {
    const line = text.trim().replace(/\s+/g, ' ');
    return line.length > 24 ? `${line.slice(0, 24)}...` : line;
};

/*
 * The menu over an editable field, native on purpose. A text field is the one place where the
 * platform brings more than we can draw: macOS hangs AutoFill, Writing Tools and Services off an
 * AppKit menu, and none of that survives a menu the renderer paints. Standard roles are what the
 * platform recognizes, so every row that has one uses it, and the rows macOS appends itself are
 * not in the template.
 */
const editableGuestMenu = (contents: Electron.WebContents, params: Electron.ContextMenuParams): void => {
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
        // Electron has no role for either of these, so they are ours: the dictionary panel is a
        // call on the guest, and the search is the same URL the client's own menu opens. Share and
        // Services are not here, because macOS appends both to a menu popped with its frame.
        template.push(
            { type: 'separator' },
            { label: `Look Up "${menuLabel(params.selectionText)}"`, click: () => contents.showDefinitionForSelection() },
            { label: 'Search with Google', click: () => void shell.openExternal(`${SEARCH_URL}${encodeURIComponent(params.selectionText)}`) }
        );
    }
    template.push({ type: 'separator' }, { label: 'Inspect element', click: () => guestDevTools(contents.id, { x: params.x, y: params.y }) });
    /*
     * The frame is the one thing that makes AutoFill appear: without it Electron pops a plain menu
     * and macOS appends none of its own rows (AutoFill, Writing Tools, Services). It is null once
     * the frame navigated away or died, and then the menu still opens, just without those rows.
     * AutoFill here routes to Apple's Passwords app only; Chrome's password manager is not in
     * Electron. No position: the menu belongs at the cursor, which is where Electron puts it.
     */
    Menu.buildFromTemplate(template).popup({ window: mainWindow ?? undefined, ...(params.frame ? { frame: params.frame } : {}) });
};

/*
 * A right-click inside a browser node's page. Electron ships no menu for web content (Chromium's own
 * belongs to the Chrome browser) and a native one reads as another program's, so the client draws
 * it: the shell says what the click landed on and nothing more. An editable field is the exception
 * and never leaves the shell, because what the platform adds to a native menu there is worth more
 * than a menu in the app's own style.
 */
const guestContextMenu = (contents: Electron.WebContents, params: Electron.ContextMenuParams): void => {
    if (params.isEditable) {
        editableGuestMenu(contents, params);
        return;
    }
    mainWindow?.webContents.send('browser:context-menu', {
        webContentsId: contents.id,
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
};

/*
 * The row the person picked, for the part of it the renderer cannot reach: the guest's own copy, a
 * download, the inspector and the system browser. The editing rows are not here, because an
 * editable field never reaches the client. Only a guest of the browser partition takes one, the
 * same guard the menu itself has.
 */
ipcMain.on('browser:context-action', (_event, request: BrowserContextAction) => {
    const contents = webContents.fromId(request.webContentsId);
    if (!contents || contents.isDestroyed() || !isBrowserGuest(contents)) {
        return;
    }
    const payload = request.payload ?? {};
    switch (request.action) {
        case 'copy':
            contents.copy();
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

/* Bytes the client made (an exported drawing) go where a native dialog says they go. */
ipcMain.handle('dialog:save-file', async (_event, suggestedName: string, bytes: Uint8Array, mime: string) => {
    if (!mainWindow) {
        return null;
    }
    const extension = suggestedName.split('.').pop() ?? '';
    const result = await dialog.showSaveDialog(mainWindow, {
        defaultPath: suggestedName,
        ...(extension ? { filters: [{ name: mime, extensions: [extension] }] } : {})
    });
    if (result.canceled || !result.filePath) {
        return null;
    }
    await writeFile(result.filePath, Buffer.from(bytes));
    return result.filePath;
});

ipcMain.handle('shell:open-external', async (_event, url: string) => {
    if (/^https?:\/\//.test(url)) {
        await shell.openExternal(url);
    }
});

ipcMain.on('devtools:guest', (_event, id: number) => guestDevTools(id));

ipcMain.handle('window:is-fullscreen', () => mainWindow?.isFullScreen() ?? false);

ipcMain.on('window:theme', (_event, theme: AppTheme) => applyTheme(theme));

/* What the client knows about updating. Mirrored in `apps/client/src/desktop/bridge.ts`. */
interface UpdateState {
    /* `unsupported` is a checkout, which has no feed; `current` means a check found nothing newer. */
    status: 'unsupported' | 'idle' | 'checking' | 'current' | 'available' | 'downloading' | 'ready' | 'error';
    currentVersion: string;
    /* The version on the other side, once a check has seen one. */
    version?: string;
    percent?: number;
    error?: string | null;
}

/*
 * electron-updater puts the whole HTTP exchange in the message of a failed check: every response
 * header, the session cookie among them. None of that belongs in a settings pane, so only the first
 * line travels, and a 404 on the feed gets the sentence that actually says what went wrong.
 */
const describeUpdateError = (message: string): string => {
    const first = message.split('\n')[0]?.trim();
    if (!first) {
        return 'No reason given.';
    }
    if (first.startsWith('404')) {
        return 'No release feed to read. Either there is no published release yet, or the repository it comes from is private.';
    }
    return first.length > 200 ? `${first.slice(0, 200)}...` : first;
};

/*
 * The updater is a state machine the client watches, not a dialog that interrupts. Every change is
 * pushed to the window, which draws the green button in the toolbar and the Updates pane. A
 * checkout has no feed (electron-updater reads `app-update.yml` from the bundle), so there the
 * state stays `unsupported` and nothing in the client offers to update.
 */
let updateState: UpdateState = { status: 'unsupported', currentVersion: app.getVersion() };
let updater: import('electron-updater').AppUpdater | null = null;
let updateTimer: ReturnType<typeof setInterval> | null = null;

/* Often enough that a release lands the same day, rarely enough to be invisible. */
const UPDATE_INTERVAL_MS = 60 * 60 * 1000;

const setUpdateState = (patch: Partial<UpdateState>): void => {
    updateState = { ...updateState, ...patch };
    mainWindow?.webContents.send('update:state', updateState);
};

const setupUpdates = (): void => {
    if (!app.isPackaged) {
        return;
    }
    try {
        const { autoUpdater } = require('electron-updater') as typeof import('electron-updater');
        updater = autoUpdater;
        // The client owns the preference and sends it before the first check, so nothing downloads
        // behind the back of someone who turned it off.
        autoUpdater.autoDownload = false;
        autoUpdater.on('checking-for-update', () => setUpdateState({ status: 'checking', error: null }));
        autoUpdater.on('update-available', (info) => setUpdateState({ status: 'available', version: info.version, error: null }));
        autoUpdater.on('update-not-available', () => setUpdateState({ status: 'current', version: undefined, error: null }));
        autoUpdater.on('download-progress', (progress) => setUpdateState({ status: 'downloading', percent: progress.percent }));
        autoUpdater.on('update-downloaded', (info) => setUpdateState({ status: 'ready', version: info.version, percent: 100 }));
        autoUpdater.on('error', (e) => setUpdateState({ status: 'error', error: describeUpdateError(e.message) }));
        setUpdateState({ status: 'idle' });
    } catch (e) {
        // electron-updater missing from the bundle is the only way here; the app stays as it is.
        console.error('The updater did not start', e);
    }
};

const checkForUpdate = async (): Promise<void> => {
    // Nothing to learn while a check or a download is running, and a build that is already waiting
    // to be installed does not get better for being asked about again.
    if (!updater || updateState.status === 'checking' || updateState.status === 'downloading' || updateState.status === 'ready') {
        return;
    }
    try {
        await updater.checkForUpdates();
    } catch (e) {
        // checkForUpdates rejects as well as emitting `error`; the state is already set there.
        console.error('Update check failed', e);
    }
};

ipcMain.handle('update:state', () => updateState);

ipcMain.handle('update:configure', (_event, autoDownload: boolean) => {
    if (!updater) {
        return;
    }
    updater.autoDownload = autoDownload;
    // The hourly check starts with the first preference the client sends, never before: until then
    // the shell does not know whether it is allowed to download what a check turns up.
    updateTimer ??= setInterval(() => void checkForUpdate(), UPDATE_INTERVAL_MS);
});

ipcMain.handle('update:check', () => checkForUpdate());

ipcMain.handle('update:download', async () => {
    if (!updater) {
        return;
    }
    try {
        await updater.downloadUpdate();
    } catch (e) {
        console.error('Update download failed', e);
    }
});

ipcMain.on('update:install', () => updater?.quitAndInstall());

/*
 * Writes the left end of the title bar band to a PNG in device pixels, which is how its geometry
 * gets measured instead of guessed. The traffic lights are native and never show up in a page
 * capture; only what the client draws next to them does.
 */
const captureTitleBar = async (window: Electron.BrowserWindow, target: string): Promise<void> => {
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 200, height: TITLEBAR_HEIGHT });
    const { scaleFactor } = screen.getDisplayMatching(window.getBounds());
    writeFileSync(target, image.toPNG({ scaleFactor }));
    console.log(`smoke: wrote ${target} at ${scaleFactor}x`);
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
    if (capturePath) {
        await captureTitleBar(window, capturePath);
        return;
    }
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
    app.on('web-contents-created', (_event, contents) => {
        /* Every guest page, the preview of an HTML file included, says when it takes the focus: a
           press inside one never reaches the client's page, and the grid has to know which cell
           the keyboard went to. */
        if (contents.getType() === 'webview') {
            contents.on('focus', () => mainWindow?.webContents.send('guest:focus', contents.id));
        }
        /* Only the pages of browser nodes get a menu. The preview partition is sealed on purpose: it
           renders a local file the panel opened, with nowhere to navigate and nothing to inspect. */
        if (!isBrowserGuest(contents)) {
            return;
        }
        contents.on('context-menu', (_e, params) => guestContextMenu(contents, params));
    });

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
        sealPreviewSession();
        startDaemon();
        try {
            await waitForDaemon();
        } catch (e) {
            dialog.showErrorBox('Ruimte', e instanceof Error ? e.message : 'The background service did not start');
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
        setupUpdates();
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
