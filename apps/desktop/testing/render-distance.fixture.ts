import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { installBrowserRoutes } from '../src/browser-routes';
import { answerAppRequest, createDesktopAppScheme } from '../src/app-scheme';

/*
 * One real <webview> in the production parking layer, zoomed past the render distance and back again
 * and again. Distance may only hide a page in its host: the guest, its parent chain, what was typed,
 * the scroll and the history all have to come through, with no second load of the page.
 */
const { app, BrowserWindow, ipcMain, protocol, webContents } = require('electron') as typeof import('electron');
const directory = process.env.RUIMTE_DISTANCE_FIXTURE!;
app.setName('Ruimte render distance integration');
app.setPath('userData', join(directory, 'profile'));
app.commandLine.appendSwitch('host-resolver-rules', 'MAP public.distance.test 127.0.0.1');
app.commandLine.appendSwitch('no-proxy-server');
app.commandLine.appendSwitch('disable-background-networking');
app.dock?.hide();
const scheme = createDesktopAppScheme(directory);
protocol.registerSchemesAsPrivileged([{ scheme: scheme.scheme, privileges: { standard: true, secure: true, supportFetchAPI: true } }]);
const loads: Record<string, number> = {};
const server = createServer((req, res) => {
    const url = new URL(req.url!, `http://${req.headers.host}`);
    loads[url.pathname] = (loads[url.pathname] ?? 0) + 1;
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', 'text/html');
    res.end(
        `<title>Distance ${url.pathname}</title><body style="margin:0;background:#c03"><input id="field"><div style="height:4000px">${url.pathname}</div></body>`
    );
});
const delay = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));
async function until<T>(read: () => Promise<T>, accepts: (value: T) => boolean, what: string): Promise<T> {
    const end = Date.now() + 10_000;
    let value = await read();
    while (Date.now() < end) {
        if (accepts(value)) {
            return value;
        }
        await delay(20);
        value = await read();
    }
    throw new Error(`Timed out waiting for ${what}: ${JSON.stringify(value)}`);
}
interface State {
    id: number | null;
    connected: boolean;
    sameHost: boolean;
    visibility: string | null;
    far: boolean;
    picture: string | null;
    row: { url: string; loading: boolean; title: string; canGoBack: boolean } | null;
}
async function run(): Promise<void> {
    await app.whenReady();
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const port = (server.address() as { port: number }).port;
    protocol.handle(scheme.scheme, (request) => answerAppRequest(scheme, request));
    let window: Electron.BrowserWindow | null = null;
    const guard = installBrowserRoutes((event) => scheme.isAppSender(window?.webContents === event.sender, event.senderFrame), join(directory, 'guest.cjs'));
    // As the shell answers it in `main.ts`: what an agent's `browser shot` and the plate's picture come through.
    ipcMain.handle('browser:capture', async (_event, id: number) => {
        const guest = webContents.fromId(id);
        return guest ? (await guest.capturePage()).toPNG() : null;
    });
    // Shown: a window that is not on screen draws nothing, and no picture of a guest comes out of it.
    window = new BrowserWindow({
        width: 1000,
        height: 700,
        show: true,
        webPreferences: { preload: join(directory, 'preload.cjs'), webviewTag: true, contextIsolation: true, nodeIntegration: false, sandbox: true }
    });
    guard.attachApp(window.webContents);
    await window.loadURL(scheme.url);
    const host = window;
    const call = async <T>(method: string, ...args: unknown[]): Promise<T> =>
        host.webContents.executeJavaScript(`window.distanceTest[${JSON.stringify(method)}](...${JSON.stringify(args)})`);
    const base = `http://public.distance.test:${port}`;
    await call('open', `${base}/first`);
    await until(() => call<State>('state'), (state) => state.row?.title === 'Distance /first' && !state.row.loading && state.id !== null, 'the first page');
    await call('navigate', `${base}/second`);
    const start = await until(() => call<State>('state'), (state) => state.row?.title === 'Distance /second' && !state.row.loading, 'the second page');
    await call('run', `document.getElementById('field').value = 'typed by hand'; window.scrollTo(0, 900); history.length`);
    const historyLength = await call<number>('run', 'history.length');
    const loadsBefore = { ...loads };
    const rafVisible = await call<number>('run', FRAMES);
    assert.ok(rafVisible > 10, `a drawn page draws frames (${rafVisible})`);

    let rafHidden = -1;
    let pictureBytes = 0;
    let shotBytes = 0;
    for (const distance of ['standard', 'far', 'standard'] as const) {
        await call('distance', distance);
        const past = distance === 'far' ? 0.15 : 0.3;
        await call('zoom', past);
        const gone = await until(() => call<State>('state'), (state) => state.far && state.visibility === 'hidden', `the page to go at ${past} on ${distance}`);
        assert.equal(gone.id, start.id);
        assert.ok(gone.sameHost && gone.connected, 'the guest keeps its host and its parents');
        if (rafHidden === -1) {
            rafHidden = await call<number>('run', FRAMES);
            pictureBytes = await until(() => call<number>('pictureBytes'), (bytes) => bytes > 0, 'the picture of the page');
            // What an agent's shot of a far page gets: it is drawn again, transparent, for the moment it takes.
            shotBytes = await call<number>('shot');
            const after = await until(() => call<State>('state'), (state) => state.visibility === 'hidden', 'the page to be hidden again after the shot');
            assert.ok(after.far);
        }
        await call('zoom', 1);
        const back = await until(() => call<State>('state'), (state) => !state.far && state.visibility === 'visible', 'the page to come back');
        assert.equal(back.id, start.id);
        assert.ok(back.sameHost && back.connected);
    }
    const field = await call<string>('run', `document.getElementById('field').value`);
    const scroll = await call<number>('run', 'window.scrollY');
    const historyAfter = await call<number>('run', 'history.length');
    const end = await call<State>('state');
    console.log(
        'RENDER_DISTANCE_RESULT ' +
            JSON.stringify({
                sameGuest: end.id === start.id && webContents.fromId(end.id!)?.isDestroyed() === false,
                sameHost: end.sameHost,
                field,
                scroll,
                history: [historyLength, historyAfter],
                canGoBack: end.row?.canGoBack,
                extraLoads: Object.keys(loads).reduce((sum, path) => sum + (loads[path]! - (loadsBefore[path] ?? 0)), 0),
                rafVisible,
                rafHidden,
                pictureBytes,
                shotBytes
            })
    );
}
// Frames the page draws in half a second.
const FRAMES =
    'new Promise(resolve => { let count = 0; const start = performance.now(); const step = () => { count++; if (performance.now() - start < 500) { requestAnimationFrame(step); } }; requestAnimationFrame(step); setTimeout(() => resolve(count), 600); })';
const timeout = setTimeout(() => {
    console.error('Render distance fixture deadline');
    app.exit(2);
}, 60_000);
void run()
    .then(() => {
        clearTimeout(timeout);
        server.close();
        app.exit(0);
    })
    .catch((error) => {
        console.error(error);
        server.close();
        app.exit(1);
    });

export interface RenderDistanceEvidence {
    sameGuest: boolean;
    sameHost: boolean;
    field: string;
    scroll: number;
    history: [number, number];
    canGoBack: boolean;
    extraLoads: number;
    rafVisible: number;
    rafHidden: number;
    pictureBytes: number;
    shotBytes: number;
}
