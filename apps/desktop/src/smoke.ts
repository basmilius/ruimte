import { writeFileSync } from 'node:fs';

export interface SmokeOptions {
    /* The app's own address, which the browser node is pointed at. */
    appUrl: string;
    /* Where to write the title bar instead of driving a browser node. */
    capturePath: string | null;
    titleBarHeight: number;
    scaleFactorOf: (window: Electron.BrowserWindow) => number;
}

function wait(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

/*
 * The left end of the title bar band as a PNG in device pixels, so its geometry is measured instead of
 * guessed. The traffic lights are native and never show up in a page capture.
 */
async function captureTitleBar(window: Electron.BrowserWindow, target: string, options: SmokeOptions): Promise<void> {
    const image = await window.webContents.capturePage({ x: 0, y: 0, width: 200, height: options.titleBarHeight });
    const scaleFactor = options.scaleFactorOf(window);
    writeFileSync(target, image.toPNG({ scaleFactor }));
    console.log(`smoke: wrote ${target} at ${scaleFactor}x`);
}

/* Adds a browser node through the client's own keyboard path, points it at the app and waits for the page. */
export async function runSmoke(window: Electron.BrowserWindow, options: SmokeOptions): Promise<void> {
    const page = window.webContents;
    console.log('smoke: window loaded');
    page.on('preload-error', (_event, path, error) => console.log(`smoke: preload error in ${path}: ${error.message}`));
    console.log(`smoke: bridge is ${await page.executeJavaScript('typeof window.ruimteDesktop')}`);
    if ((await page.executeJavaScript('typeof window.ruimte')) === 'undefined') {
        // A production client has no test hooks; that the daemon served it and the bridge is there is the whole test.
        console.log('smoke: production client, no test hooks to drive a browser node');
        return;
    }
    page.on('console-message', (event) => {
        if (event.level === 'error') {
            console.log(`smoke: renderer error: ${event.message.slice(0, 200)}`);
        }
    });
    await wait(1500);
    if (options.capturePath) {
        await captureTitleBar(window, options.capturePath, options);
        return;
    }
    await page.executeJavaScript(`window.dispatchEvent(new KeyboardEvent('keydown', { key: 'b', code: 'KeyB', altKey: true, bubbles: true }))`);
    await wait(500);
    const target = options.appUrl;
    await page.executeJavaScript(
        `(() => { const ids = window.ruimte?.nodeIds() ?? []; const id = ids[ids.length - 1]; if (id) { window.ruimte.browserNavigate(id, ${JSON.stringify(target)}); } })()`
    );
    for (let attempt = 0; attempt < 40; attempt++) {
        await wait(250);
        const state = (await page.executeJavaScript(
            `(() => { const ids = window.ruimte?.nodeIds() ?? []; const id = ids[ids.length - 1]; return id ? window.ruimte.browserState(id) : null; })()`
        )) as { url: string; loading: boolean; title: string; error: string | null } | null;
        if (state && !state.loading && state.url.startsWith(target)) {
            console.log(`smoke: browser node loaded ${state.url} (${state.error ?? state.title})`);
            return;
        }
    }
    const detail = await page.executeJavaScript(
        `(() => { const ids = window.ruimte?.nodeIds() ?? []; const id = ids[ids.length - 1]; const views = [...document.querySelectorAll('webview')]; return JSON.stringify({ ids, state: id ? window.ruimte.browserState(id) : null, views: views.map((v) => ({ src: v.getAttribute('src'), attached: v.isConnected, parent: v.parentElement?.style.visibility })) }); })()`
    );
    console.log(`smoke: the browser node did not finish loading: ${detail}`);
}
