import { mkdir, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { VISUAL_DARK_THEME, VISUAL_LIGHT_THEME, VISUAL_LIMITS, visualThemeFragment } from '@ruimte/contracts';
import { errorText } from '../error-text.ts';
import { browserEntry, ConsoleLog, consoleLevel, consoleText, exceptionText } from './page-console.ts';
import { PAGE_ORIGIN, PAGE_URL, PageSource } from './page-source.ts';
import { RenderRequestSchema, SHOT_MAX_HEIGHT, type RenderAnswer, type RenderedPage, type RenderRequest } from './render-protocol.ts';
import { startSocksProxy, SYSTEM_SOCKS_DEPS, type SocksRequest } from './socks-proxy.ts';

/*
 * The render child: a process of its own with a Chrome of its own, started by the daemon for one
 * preview or one measurement. Chrome is started once per process and its first view's flags and
 * profile win, so this is the only way to keep it off the daemon's browser profile and behind the
 * proxy. The profile is a throwaway folder the daemon made.
 */

// A short viewport, so a page whose root fills the viewport reports its content and not the viewport.
const VIEWPORT_HEIGHT = VISUAL_LIMITS.minHeight;
const LOAD_LIMIT_MS = 10_000;
const SETTLE_LIMIT_MS = 3_000;
// What a page needs after its load: to settle and be measured, and for a preview to settle at its full height and be photographed.
const AFTER_LOAD_MS = { measure: 1_000, capture: 4_000 } as const;
// What a settled page keeps of its time to be measured.
const MEASURE_MS = 250;

function chromeFlags(proxyPort: number): string[] {
    return [
        `--proxy-server=socks5://127.0.0.1:${proxyPort}`,
        // Chrome goes to loopback past any proxy unless this takes that rule away.
        '--proxy-bypass-list=<-loopback>',
        '--disable-quic',
        '--block-new-web-contents',
        '--force-device-scale-factor=1'
    ];
}

/*
 * WebRTC sends UDP, which a SOCKS proxy does not carry. Its command line switch reaches a headless
 * Chrome without effect, so the policy goes into the profile, which Chrome reads at its start.
 */
async function writeProfile(profile: string): Promise<void> {
    await mkdir(join(profile, 'Default'), { recursive: true });
    await writeFile(join(profile, 'Default', 'Preferences'), JSON.stringify({ webrtc: { ip_handling_policy: 'disable_non_proxied_udp' } }));
}

type Outcome<T> = { status: 'done'; value: T } | { status: 'failed'; error: unknown } | { status: 'late' };

function within<T>(promise: Promise<T>, ms: number): Promise<Outcome<T>> {
    return new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ status: 'late' }), Math.max(0, ms));
        promise.then(
            (value) => {
                clearTimeout(timer);
                resolve({ status: 'done', value });
            },
            (error: unknown) => {
                clearTimeout(timer);
                resolve({ status: 'failed', error });
            }
        );
    });
}

/* Fonts loaded and two frames painted, or the limit, whichever comes first; never left pending, since a view takes one evaluate at a time. */
function settleScript(limitMs: number): string {
    return `Promise.race([
        (document.fonts ? document.fonts.ready : Promise.resolve()).then(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))),
        new Promise((resolve) => setTimeout(() => resolve(false), ${limitMs}))
    ])`;
}

/* The root's own box, or what overflows it when the root is only as tall as the viewport; and whether the page is in quirks mode. */
const HEIGHT_SCRIPT = `(() => {
    const root = document.documentElement;
    const box = root.getBoundingClientRect().height;
    return [Math.ceil(Math.max(box, root.scrollHeight > root.clientHeight ? root.scrollHeight : 0)), document.compatMode === 'BackCompat'];
})()`;

interface PausedRequest {
    requestId: string;
    request: { url: string };
    resourceType: string;
    frameId?: string;
}

/* The page's own load event, told from a world of its own that the page cannot see or call. */
const LOAD_WORLD = 'visual-preview';
const LOAD_BINDING = 'visualPreviewLoaded';
const LOAD_SCRIPT = `addEventListener('load', () => { if (window === top) { ${LOAD_BINDING}(''); } });`;
const READY_POLL_MS = 100;

/* A view with its protocol calls one after the other, since a view takes one call at a time, and the loads of its page. */
class PageView {
    readonly view: Bun.WebView;
    mainFrame = '';
    private tail: Promise<unknown> = Promise.resolve();
    private loadWaiters: Array<() => void> = [];
    private refusalWaiters: Array<() => void> = [];

    constructor(view: Bun.WebView) {
        this.view = view;
    }

    cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
        const run = this.tail.then(() => this.view.cdp<T>(method, params));
        this.tail = run.catch(() => undefined);
        return run;
    }

    nextLoad(): Promise<void> {
        return new Promise((resolve) => this.loadWaiters.push(resolve));
    }

    loaded(): void {
        for (const resolve of this.loadWaiters.splice(0)) {
            resolve();
        }
    }

    nextRefusal(): Promise<void> {
        return new Promise((resolve) => this.refusalWaiters.push(resolve));
    }

    /* The main frame was kept from going elsewhere. */
    refused(): void {
        for (const resolve of this.refusalWaiters.splice(0)) {
            resolve();
        }
    }
}

interface RenderContext {
    request: RenderRequest;
    source: PageSource;
    address: string;
    log: ConsoleLog | null;
    deadline: number;
}

function remaining(context: RenderContext): number {
    return context.deadline - Date.now();
}

function onPage(href: string): boolean {
    const url = URL.parse(href);
    return url?.protocol === 'https:' && url.origin === PAGE_ORIGIN;
}

/*
 * The page is answered from memory on its made-up origin, the main frame never leaves it, and
 * anything else on that origin, a relative path, is not there. Frames of other origins load
 * through the proxy like any other resource.
 */
async function answer(page: PageView, paused: PausedRequest, context: RenderContext): Promise<void> {
    const requestId = paused.requestId;
    const url = URL.parse(paused.request.url);
    const onOrigin = url?.origin === PAGE_ORIGIN;
    const mainDocument = paused.resourceType === 'Document' && paused.frameId === page.mainFrame;
    try {
        if (mainDocument && onOrigin && url?.pathname === '/page.html') {
            await page.cdp('Fetch.fulfillRequest', {
                requestId,
                responseCode: 200,
                responseHeaders: [{ name: 'content-type', value: 'text/html; charset=utf-8' }],
                body: Buffer.from(context.source.served, 'utf8').toString('base64')
            });
        } else if (mainDocument) {
            context.log?.add('error', `The page tried to go to ${context.source.describe(paused.request.url)}; a visual stays on its own page`);
            // A 204 keeps the document where it is; a failed navigation would put an error page in its place.
            await page.cdp('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: [] });
            page.refused();
        } else if (!onOrigin) {
            await page.cdp('Fetch.continueRequest', { requestId });
        } else {
            await page.cdp('Fetch.fulfillRequest', { requestId, responseCode: url?.pathname === '/favicon.ico' ? 204 : 404, responseHeaders: [] });
        }
    } catch {
        // The view closed while the request waited.
    }
}

async function prepare(page: PageView, width: number, context: RenderContext): Promise<void> {
    const { view } = page;
    await view.resize(width, VIEWPORT_HEIGHT);
    // A view starts in the background, where a page paints no frame.
    await page.cdp('Emulation.setFocusEmulationEnabled', { enabled: true });
    await page.cdp('Emulation.setEmulatedMedia', {
        features: [
            { name: 'prefers-color-scheme', value: context.request.appearance },
            { name: 'prefers-reduced-motion', value: 'reduce' }
        ]
    });
    const log = context.log;
    if (log !== null) {
        view.addEventListener('Runtime.exceptionThrown', (event) => {
            log.add('exception', context.source.describe(exceptionText((event as MessageEvent<{ exceptionDetails: object }>).data.exceptionDetails)));
        });
        view.addEventListener('Log.entryAdded', (event) => {
            const entry = browserEntry((event as MessageEvent<{ entry: object }>).data.entry);
            if (entry !== null) {
                log.add(entry.level, context.source.describe(entry.text));
            }
        });
        await page.cdp('Log.enable');
    }
    const tree = await page.cdp<{ frameTree: { frame: { id: string } } }>('Page.getFrameTree');
    page.mainFrame = tree.frameTree.frame.id;
    view.addEventListener('Runtime.bindingCalled', (event) => {
        if ((event as MessageEvent<{ name: string }>).data.name === LOAD_BINDING) {
            page.loaded();
        }
    });
    await page.cdp('Runtime.enable');
    await page.cdp('Runtime.addBinding', { name: LOAD_BINDING, executionContextName: LOAD_WORLD });
    await page.cdp('Page.addScriptToEvaluateOnNewDocument', { source: LOAD_SCRIPT, worldName: LOAD_WORLD });
    view.addEventListener('Fetch.requestPaused', (event) => {
        void answer(page, (event as MessageEvent<PausedRequest>).data, context);
    });
    await page.cdp('Fetch.enable', {
        patterns: [
            { urlPattern: '*', resourceType: 'Document', requestStage: 'Request' },
            { urlPattern: `${PAGE_ORIGIN}/*`, requestStage: 'Request' }
        ]
    });
}

/*
 * Once the page tried to go elsewhere the browser fires no load event for it, though it finishes,
 * so then its state is read until it is complete.
 */
async function completed(page: PageView): Promise<void> {
    for (let i = 0; i < LOAD_LIMIT_MS / READY_POLL_MS; i++) {
        const state = await page.cdp<{ result: { value?: unknown } }>('Runtime.evaluate', { expression: 'document.readyState', returnByValue: true });
        if (state.result.value === 'complete') {
            return;
        }
        await Bun.sleep(READY_POLL_MS);
    }
}

/* Waits for the load of the page `start` sends the main frame to; false when the navigation failed. */
async function load(page: PageView, context: RenderContext, limitMs: number, start: () => Promise<unknown>): Promise<boolean> {
    const loaded = page.nextLoad();
    const refused = page.nextRefusal().then(() => completed(page));
    const outcome = await within(Promise.race([loaded, refused, start().then(() => loaded)]), limitMs);
    if (outcome.status === 'late') {
        context.log?.add('warning', `The page had not finished loading after ${Math.round(limitMs / 1000)} s; this shows it as far as it got`);
    }
    return outcome.status !== 'failed';
}

async function settle(page: PageView, limitMs: number): Promise<void> {
    const limit = Math.max(0, limitMs);
    await within(page.view.evaluate(settleScript(limit)), limit + 500);
}

/* One width: load, settle, keep the page in place, measure, and for a preview photograph it. Null when time ran out. */
async function renderPage(page: PageView, width: number, context: RenderContext): Promise<RenderedPage | null> {
    await prepare(page, width, context);
    const afterLoad = context.request.capture ? AFTER_LOAD_MS.capture : AFTER_LOAD_MS.measure;
    const loadLimit = Math.min(LOAD_LIMIT_MS, remaining(context) - afterLoad);
    if (loadLimit <= 0 || !(await load(page, context, loadLimit, () => page.view.navigate(context.address)))) {
        return null;
    }
    await settle(page, Math.min(SETTLE_LIMIT_MS, remaining(context) - MEASURE_MS));
    const here = await within(page.view.evaluate<string>('location.href'), 1_000);
    if (here.status === 'done' && !onPage(here.value)) {
        // A document no request reaches, such as about:blank or a blob, which only a script of the page opens.
        context.log?.add('error', `The page went to ${context.source.describe(here.value)}; a visual stays on its own page, so this shows it loaded again`);
        const back = `location.replace(${JSON.stringify(context.address)})`;
        await load(page, context, Math.min(LOAD_LIMIT_MS, remaining(context) - afterLoad), () => page.view.evaluate(back));
        await settle(page, Math.min(SETTLE_LIMIT_MS, remaining(context) - MEASURE_MS));
    }
    const measured = await within(page.view.evaluate<[number, boolean]>(HEIGHT_SCRIPT), Math.max(0, remaining(context)));
    if (measured.status !== 'done' || !Array.isArray(measured.value) || typeof measured.value[0] !== 'number' || remaining(context) <= 0) {
        return null;
    }
    const [height, quirks] = measured.value;
    if (quirks) {
        context.log?.add(
            'warning',
            'The page has no <!doctype html>, so the browser draws it in quirks mode and the frame cannot take the height of the page itself'
        );
    }
    if (!context.request.capture) {
        return { width, height };
    }
    const shotHeight = Math.min(Math.max(height, VISUAL_LIMITS.minHeight), SHOT_MAX_HEIGHT);
    await page.view.resize(width, shotHeight);
    await settle(page, Math.min(1_000, remaining(context)));
    const shot = await page.cdp<{ data: string }>('Page.captureScreenshot', {
        format: 'png',
        clip: { x: 0, y: 0, width, height: shotHeight, scale: 1 }
    });
    return { width, height, shot: shot.data, shotHeight, console: context.log?.entries ?? [], omitted: context.log?.omitted ?? 0 };
}

function blockedLine(target: SocksRequest): string {
    const where = target.type === 'ipv6' ? `[${target.host}]:${target.port}` : `${target.host}:${target.port}`;
    return `Blocked a connection to ${where}: a visual reaches public addresses only, never this machine or its network`;
}

export async function render(request: RenderRequest): Promise<RenderAnswer> {
    const context: RenderContext = {
        request,
        source: new PageSource(request.html),
        address: `${PAGE_URL}${visualThemeFragment(request.appearance === 'light' ? VISUAL_LIGHT_THEME : VISUAL_DARK_THEME)}`,
        log: request.capture ? new ConsoleLog() : null,
        deadline: Date.now() + request.budgetMs
    };
    await writeProfile(request.profile);
    const blocked = new Set<string>();
    const proxy = await startSocksProxy(SYSTEM_SOCKS_DEPS, (target) => {
        const line = blockedLine(target);
        if (!blocked.has(line)) {
            blocked.add(line);
            context.log?.add('error', line);
        }
    });
    // No size here: a Chrome view takes its size from a resize only, and with one given here a capture after a navigation the page was kept from never returns.
    const open = (): PageView => {
        const log = context.log;
        return new PageView(
            new Bun.WebView({
                backend: { type: 'chrome', url: false, argv: chromeFlags(proxy.port) },
                headless: true,
                dataStore: { directory: request.profile },
                ...(log === null
                    ? {}
                    : {
                          console: (type: string, ...values: unknown[]) => {
                              const level = consoleLevel(type);
                              if (level !== null) {
                                  log.add(level, context.source.describe(consoleText(values)));
                              }
                          }
                      })
            })
        );
    };
    const views: PageView[] = [];
    try {
        try {
            const first = open();
            views.push(first);
            const started = await within(first.view.navigate('about:blank'), remaining(context));
            if (started.status === 'failed') {
                return { ok: false, code: 'browser-unavailable', message: errorText(started.error) };
            }
            if (started.status === 'late') {
                return { ok: true, pages: [] };
            }
        } catch (e) {
            return { ok: false, code: 'browser-unavailable', message: errorText(e) };
        }
        const others = request.widths.slice(1).map(() => open());
        views.push(...others);
        await Promise.all(others.map((view) => view.view.navigate('about:blank')));
        const pages: RenderedPage[] = [];
        const work = Promise.allSettled(
            request.widths.map(async (width, index) => {
                const page = await renderPage(views[index]!, width, context);
                if (page !== null) {
                    pages.push(page);
                }
            })
        );
        await within(work, remaining(context));
        return { ok: true, pages: pages.toSorted((a, b) => a.width - b.width) };
    } finally {
        for (const view of views) {
            view.view.close();
        }
        proxy.close();
    }
}

async function readLine(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<string | null> {
    const decoder = new TextDecoder();
    let text = '';
    for (;;) {
        const { done, value } = await reader.read();
        if (done) {
            return null;
        }
        text += decoder.decode(value, { stream: true });
        const end = text.indexOf('\n');
        if (end >= 0) {
            return text.slice(0, end);
        }
    }
}

async function untilClosed(reader: ReadableStreamDefaultReader<Uint8Array>): Promise<void> {
    for (;;) {
        const { done } = await reader.read();
        if (done) {
            return;
        }
    }
}

function parseJson(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}

/* `ruimte visual-render`: reads one request on stdin and answers on stdout. */
export async function runRenderChild(): Promise<number> {
    const reader = Bun.stdin.stream().getReader();
    const line = await readLine(reader);
    if (line === null) {
        return 1;
    }
    const parsed = RenderRequestSchema.safeParse(parseJson(line));
    // The daemon keeps stdin open until it has the answer; its end means the daemon went, and the browser and the profile go with this process.
    const leaving: { done: Promise<void> | null } = { done: null };
    void untilClosed(reader).then(() => {
        Bun.WebView.closeAll();
        leaving.done = (async () => {
            if (parsed.success) {
                await rm(parsed.data.profile, { recursive: true, force: true, maxRetries: 3 }).catch(() => undefined);
            }
            process.exit(0);
        })();
    });
    let result: RenderAnswer;
    if (!parsed.success) {
        result = { ok: false, code: 'render-failed', message: 'The render request did not parse' };
    } else {
        // A limit of its own, should the daemon hold on without killing it.
        setTimeout(() => process.exit(2), parsed.data.budgetMs + 5_000);
        result = await render(parsed.data).catch((e: unknown): RenderAnswer => ({ ok: false, code: 'render-failed', message: errorText(e) }));
    }
    // Closing the browser ends the render at once; the profile still has to go before this process does.
    await leaving.done;
    await Bun.write(Bun.stdout, `${JSON.stringify(result)}\n`);
    return result.ok ? 0 : 1;
}
