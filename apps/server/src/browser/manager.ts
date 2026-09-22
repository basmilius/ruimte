import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
    BROWSER_FAVICON_MAX_BYTES,
    BROWSER_FAVICON_MAX_DATA_URL_LENGTH,
    type BrowserDriveAction,
    type BrowserFrame,
    type BrowserInfo,
    type BrowserInput,
    type LiveStreamFrame
} from '@ruimte/contracts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { LiveStreamHub, type LiveFrameSource } from '../streams/live-stream.ts';
import { CodedError } from '../coded-error.ts';
import { FrameFanout, streamKeyOf } from '../streams/frame-fanout.ts';
import { ClientSinks } from '../client-sinks.ts';

interface NavigationHistory {
    currentIndex: number;
    entries: unknown[];
}

interface ScreencastFrame {
    data: string;
    metadata?: { deviceWidth?: number; deviceHeight?: number };
    sessionId: number;
}

interface CapturedFrame {
    data: string;
}

export interface BrowserPage {
    readonly url: string;
    readonly title: string;
    readonly loading: boolean;
    onNavigated: ((url: string, title?: string) => void) | null;
    onNavigationFailed: ((error: Error) => void) | null;
    addEventListener(type: string, listener: (event: MessageEvent<ScreencastFrame>) => void): void;
    navigate(url: string): Promise<void>;
    resize(width: number, height: number): Promise<void>;
    back(): Promise<void>;
    forward(): Promise<void>;
    reload(): Promise<void>;
    type(text: string): Promise<void>;
    evaluate<T = unknown>(expression: string): Promise<T>;
    cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    close(): void;
}

export type BrowserPageFactory = (width: number, height: number) => BrowserPage;

type BrowserErrorCode = 'bad-address' | 'browser-not-found' | 'browser-unavailable';

export class BrowserError extends CodedError<BrowserErrorCode> {}

const normalizeUrl = (input: string): string => {
    const trimmed = input.trim();
    if (trimmed === '') {
        return 'about:blank';
    }
    const local = /^localhost(:\d+)?(\/|$)/.test(trimmed) || /^\d+\.\d+\.\d+\.\d+/.test(trimmed);
    const value = local ? `http://${trimmed}` : /^[a-z][a-z0-9+.-]*:/i.test(trimmed) ? trimmed : `https://${trimmed}`;
    let parsed: URL;
    try {
        parsed = new URL(value);
    } catch {
        throw new BrowserError('bad-address', 'Enter a valid web address');
    }
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:' && value !== 'about:blank') {
        throw new BrowserError('bad-address', 'Only HTTP and HTTPS pages can be opened');
    }
    return value;
};

/* A page the length of a book would push everything else out of an agent's window; an article fits well inside this. */
export const BROWSER_TEXT_MAX_CHARS = 40_000;

/* What the page says, as a reader sees it: `innerText` leaves out what is hidden and keeps the line breaks the layout makes. */
const PAGE_TEXT_EXPRESSION = `(document.body ? document.body.innerText : '').slice(0, ${BROWSER_TEXT_MAX_CHARS})`;

const FAVICON_DATA_URL = /^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i;
const LOCATION_EXPRESSION = 'location.href';
const USER_AGENT_EXPRESSION = 'navigator.userAgent';
const FAVICON_EXPRESSION = `
(async () => {
    const declared = [...document.querySelectorAll('link[rel~="icon"]')].at(-1)?.href;
    const href = declared && declared !== 'data:,' ? declared : new URL('/favicon.ico', location.href).href;
    const response = await fetch(href, { credentials: 'include' });
    if (!response.ok) return null;
    let type = (response.headers.get('content-type') || '').split(';', 1)[0].trim().toLowerCase();
    if ((!type || type === 'application/octet-stream') && new URL(href).pathname.toLowerCase().endsWith('.ico')) type = 'image/x-icon';
    if (!/^image\\/[a-z0-9.+-]+$/.test(type)) return null;
    const buffer = await response.arrayBuffer();
    if (buffer.byteLength > ${BROWSER_FAVICON_MAX_BYTES}) return null;
    const bytes = new Uint8Array(buffer);
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return 'data:' + type + ';base64,' + btoa(binary);
})()
`;

const validFavicon = (value: unknown): string | null =>
    typeof value === 'string' && value.length <= BROWSER_FAVICON_MAX_DATA_URL_LENGTH && FAVICON_DATA_URL.test(value) ? value : null;

class BrowserSession implements LiveFrameSource {
    readonly clients = new Set<string>();
    readonly id: string;
    readonly clientId: string;
    readonly streamId: string;
    private readonly page: BrowserPage;
    private readonly changed: (state: BrowserInfo) => void;
    private width: number;
    private height: number;
    private deviceScaleFactor = 1;
    private state: BrowserInfo;
    private pageTail = Promise.resolve<unknown>(undefined);
    private resizeTail = Promise.resolve<unknown>(undefined);
    private publish: ((frame: { sequence: number; width: number; height: number; data: Uint8Array }) => void) | null = null;
    private sequence = 0;
    private streaming = false;
    private bootstrapping = false;
    private capturingHighDensityFrame = false;

    constructor(id: string, clientId: string, streamId: string, page: BrowserPage, width: number, height: number, changed: (state: BrowserInfo) => void) {
        this.id = id;
        this.clientId = clientId;
        this.streamId = streamId;
        this.page = page;
        this.width = width;
        this.height = height;
        this.changed = changed;
        this.state = {
            browserId: id,
            url: page.url || 'about:blank',
            title: page.title,
            loading: page.loading,
            canGoBack: false,
            canGoForward: false,
            error: null,
            favicon: null,
            streamId
        };
        page.onNavigated = (url, title) => {
            if (this.bootstrapping) {
                return;
            }
            const reportedUrl = url === 'about:blank' && this.state.loading && this.state.url !== 'about:blank' ? this.state.url : url;
            this.state = {
                ...this.state,
                url: reportedUrl,
                title: title ?? page.title ?? '',
                loading: false,
                error: null
            };
            this.changed(this.info());
            queueMicrotask(() => {
                void this.refreshPage(reportedUrl);
            });
        };
        page.onNavigationFailed = (error) => {
            if (this.bootstrapping) {
                return;
            }
            this.state = {
                ...this.state,
                loading: false,
                error: error.message
            };
            this.changed(this.info());
        };
        page.addEventListener('Page.screencastFrame', (event) => {
            const frame = event.data;
            const publish = this.publish;
            if (publish && this.deviceScaleFactor > 1) {
                this.captureHighDensityFrame(publish, frame.sessionId);
                return;
            }
            this.enqueueCdp('Page.screencastFrameAck', {
                sessionId: frame.sessionId
            }).catch(() => undefined);
            if (!publish) {
                return;
            }
            this.emitFrame(
                publish,
                Buffer.from(frame.data, 'base64'),
                Math.round(frame.metadata?.deviceWidth ?? this.width),
                Math.round(frame.metadata?.deviceHeight ?? this.height)
            );
        });
    }

    async prepare(): Promise<void> {
        this.bootstrapping = true;
        try {
            await this.enqueuePage(() => this.page.navigate('about:blank'));
            const current = await this.enqueuePage(() => this.page.evaluate<unknown>(USER_AGENT_EXPRESSION)).catch(() => null);
            if (typeof current === 'string' && current.includes('HeadlessChrome/')) {
                await this.enqueueCdp('Network.setUserAgentOverride', {
                    userAgent: current.replace('HeadlessChrome/', 'Chrome/')
                }).catch(() => undefined);
            }
        } finally {
            this.bootstrapping = false;
        }
    }

    info(): BrowserInfo {
        return { ...this.state };
    }

    /* The text of the page as it stands. It only reads: nothing here navigates, reloads or clicks. */
    async text(): Promise<string> {
        const value = await this.enqueuePage(() => this.page.evaluate<unknown>(PAGE_TEXT_EXPRESSION)).catch(() => null);
        return typeof value === 'string' ? value.trim() : '';
    }

    /* A png of the page as it stands, for an agent that asked for a picture of what it is working on. */
    async capture(): Promise<Uint8Array> {
        const captured = await this.enqueueCdp<CapturedFrame>('Page.captureScreenshot', { format: 'png', fromSurface: true, captureBeyondViewport: false });
        return Buffer.from(captured.data, 'base64');
    }

    async navigate(input: string): Promise<void> {
        const url = normalizeUrl(input);
        this.state = {
            ...this.state,
            url,
            loading: true,
            error: null,
            favicon: null
        };
        this.changed(this.info());
        try {
            await this.enqueuePage(() => this.page.navigate(url));
            this.state = {
                ...this.state,
                url: await this.currentUrl(url),
                title: this.page.title ?? '',
                loading: this.page.loading,
                error: null
            };
            this.changed(this.info());
            await this.refreshHistory();
        } catch (error) {
            if (this.state.loading) {
                this.state = {
                    ...this.state,
                    loading: false,
                    error: error instanceof Error ? error.message : 'Page failed to load'
                };
                this.changed(this.info());
            }
        }
    }

    resize(width: number, height: number, deviceScaleFactor = 1): Promise<void> {
        const next = this.resizeTail.then(() => this.performResize(width, height, deviceScaleFactor));
        this.resizeTail = next.catch(() => undefined);
        return next;
    }

    private async performResize(width: number, height: number, deviceScaleFactor: number): Promise<void> {
        if (this.width === width && this.height === height && this.deviceScaleFactor === deviceScaleFactor) {
            return;
        }
        const publish = this.publish;
        if (this.streaming) {
            await this.stop();
        }
        this.width = width;
        this.height = height;
        this.deviceScaleFactor = deviceScaleFactor;
        await this.enqueuePage(() => this.page.resize(width, height));
        await this.enqueueCdp('Emulation.setDeviceMetricsOverride', {
            width,
            height,
            deviceScaleFactor,
            mobile: false
        });
        if (publish) {
            await this.start(publish);
        }
    }

    async command(command: 'back' | 'forward' | 'reload' | 'stop', ignoreCache = false): Promise<void> {
        this.state = {
            ...this.state,
            loading: command !== 'stop',
            error: null
        };
        this.changed(this.info());
        if (command === 'back') {
            await this.enqueuePage(() => this.page.back());
        } else if (command === 'forward') {
            await this.enqueuePage(() => this.page.forward());
        } else if (command === 'reload' && !ignoreCache) {
            await this.enqueuePage(() => this.page.reload());
        } else if (command === 'reload') {
            await this.enqueueCdp('Page.reload', { ignoreCache: true });
        } else {
            await this.enqueueCdp('Page.stopLoading');
            this.state = { ...this.state, loading: false };
            this.changed(this.info());
        }
    }

    async input(input: BrowserInput): Promise<void> {
        if (input.kind === 'text') {
            await this.enqueuePage(() => this.page.type(input.text));
            return;
        }
        if (input.kind === 'wheel') {
            await this.enqueueCdp('Input.dispatchMouseEvent', {
                type: 'mouseWheel',
                x: input.x,
                y: input.y,
                deltaX: input.deltaX,
                deltaY: input.deltaY,
                modifiers: input.modifiers ?? 0
            });
            return;
        }
        if (input.kind === 'pointer') {
            await this.enqueueCdp('Input.dispatchMouseEvent', {
                type: input.phase === 'down' ? 'mousePressed' : input.phase === 'up' ? 'mouseReleased' : 'mouseMoved',
                x: input.x,
                y: input.y,
                button: input.button ?? 'none',
                buttons: input.buttons ?? 0,
                clickCount: input.phase === 'move' ? 0 : 1,
                modifiers: input.modifiers ?? 0
            });
            return;
        }
        await this.enqueueCdp('Input.dispatchKeyEvent', {
            type: input.phase === 'down' ? 'keyDown' : 'keyUp',
            key: input.key,
            code: input.code,
            text: input.phase === 'down' ? input.text : undefined,
            modifiers: input.modifiers ?? 0
        });
    }

    async start(publish: (frame: { sequence: number; width: number; height: number; data: Uint8Array }) => void): Promise<void> {
        this.publish = publish;
        if (this.streaming) {
            return;
        }
        await this.enqueueCdp('Page.enable');
        await this.enqueueCdp('Page.startScreencast', {
            format: 'jpeg',
            quality: 78,
            maxWidth: Math.round(this.width * this.deviceScaleFactor),
            maxHeight: Math.round(this.height * this.deviceScaleFactor),
            everyNthFrame: 1
        });
        this.streaming = true;
    }

    async stop(): Promise<void> {
        this.publish = null;
        if (!this.streaming) {
            return;
        }
        this.streaming = false;
        await this.enqueueCdp('Page.stopScreencast').catch(() => undefined);
    }

    close(): void {
        this.publish = null;
        this.page.close();
    }

    private emitFrame(
        publish: (frame: { sequence: number; width: number; height: number; data: Uint8Array }) => void,
        data: Uint8Array,
        width: number,
        height: number
    ): void {
        this.sequence = (this.sequence + 1) >>> 0;
        publish({ sequence: this.sequence, width, height, data });
    }

    private captureHighDensityFrame(
        publish: (frame: { sequence: number; width: number; height: number; data: Uint8Array }) => void,
        screencastSessionId: number
    ): void {
        if (this.capturingHighDensityFrame) {
            this.enqueueCdp('Page.screencastFrameAck', { sessionId: screencastSessionId }).catch(() => undefined);
            return;
        }
        this.capturingHighDensityFrame = true;
        const width = Math.round(this.width * this.deviceScaleFactor);
        const height = Math.round(this.height * this.deviceScaleFactor);
        // Chrome's screencast stays at 1x DPR; captureScreenshot preserves the emulated DPR.
        void this.enqueuePage(async () => {
            await this.page.cdp('Page.screencastFrameAck', { sessionId: screencastSessionId });
            return this.page.cdp<CapturedFrame>('Page.captureScreenshot', {
                format: 'jpeg',
                quality: 78,
                fromSurface: true,
                captureBeyondViewport: false
            });
        })
            .then((captured) => {
                if (this.publish === publish) {
                    this.emitFrame(publish, Buffer.from(captured.data, 'base64'), width, height);
                }
            })
            .catch(() => undefined)
            .finally(() => {
                this.capturingHighDensityFrame = false;
            });
    }

    private enqueueCdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
        return this.enqueuePage(() => this.page.cdp<T>(method, params));
    }

    private enqueuePage<T>(operation: () => Promise<T>): Promise<T> {
        const next = this.pageTail.then(operation);
        this.pageTail = next.catch(() => undefined);
        return next;
    }

    private async refreshHistory(): Promise<void> {
        try {
            const history = await this.enqueueCdp<NavigationHistory>('Page.getNavigationHistory');
            this.state = {
                ...this.state,
                canGoBack: history.currentIndex > 0,
                canGoForward: history.currentIndex < history.entries.length - 1
            };
            this.changed(this.info());
        } catch {
            this.state = {
                ...this.state,
                canGoBack: false,
                canGoForward: false
            };
        }
    }

    private async currentUrl(fallback: string): Promise<string> {
        const value = await this.enqueuePage(() => this.page.evaluate<unknown>(LOCATION_EXPRESSION)).catch(() => null);
        if (typeof value !== 'string') {
            return fallback;
        }
        try {
            return normalizeUrl(value);
        } catch {
            return fallback;
        }
    }

    private async refreshPage(fallbackUrl: string): Promise<void> {
        this.state = {
            ...this.state,
            url: await this.currentUrl(fallbackUrl),
            title: this.page.title ?? '',
            loading: this.page.loading
        };
        this.changed(this.info());
        void this.refreshHistory();
        void this.refreshFavicon();
    }

    private async refreshFavicon(): Promise<void> {
        const url = this.state.url;
        const favicon = validFavicon(await this.enqueuePage(() => this.page.evaluate(FAVICON_EXPRESSION)).catch(() => null));
        if (this.state.url !== url || this.state.favicon === favicon) {
            return;
        }
        this.state = { ...this.state, favicon };
        this.changed(this.info());
    }
}

export class BrowserManager {
    private readonly sessions = new Map<string, BrowserSession>();
    private readonly sinks = new ClientSinks();
    private readonly frames: FrameFanout;
    private readonly unregisterStreams = new Map<string, () => void>();
    readonly streams: LiveStreamHub;
    private readonly createPage: BrowserPageFactory;

    constructor(streams: LiveStreamHub, createPage: BrowserPageFactory) {
        this.streams = streams;
        this.createPage = createPage;
        this.frames = new FrameFanout(streams, this.sinks);
    }

    static withBun(home: string, streams = new LiveStreamHub()): BrowserManager {
        const profile = join(home, 'browser');
        return new BrowserManager(
            streams,
            (width, height) =>
                new Bun.WebView({
                    backend: { type: 'chrome', url: false },
                    headless: true,
                    width,
                    height,
                    dataStore: { directory: profile }
                }) as unknown as BrowserPage
        );
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    async open(
        browserId: string,
        clientId: string,
        url: string,
        width: number,
        height: number,
        stream: 'http' | 'events' = 'http',
        deviceScaleFactor = 1
    ): Promise<BrowserInfo> {
        const key = sessionKey(browserId, clientId);
        let session = this.sessions.get(key);
        if (!session) {
            let page: BrowserPage;
            try {
                page = this.createPage(width, height);
            } catch (error) {
                throw new BrowserError('browser-unavailable', error instanceof Error ? error.message : 'Headless Chrome is not available');
            }
            session = new BrowserSession(browserId, clientId, `browser:${randomUUID()}`, page, width, height, (info) => this.broadcast(session!, info));
            this.sessions.set(key, session);
            this.unregisterStreams.set(key, this.streams.register(session.streamId, session));
            session.clients.add(clientId);
            await session.prepare();
            await session.navigate(url);
            await session.resize(width, height, deviceScaleFactor);
        } else {
            session.clients.add(clientId);
            if (session.info().url === 'about:blank' && normalizeUrl(url) !== 'about:blank') {
                await session.navigate(url);
            }
            await session.resize(width, height, deviceScaleFactor);
        }
        if (stream === 'events') {
            const events = (frame: LiveStreamFrame): SessionEvent => ({ event: 'browser.frame', payload: eventFrame(browserId, frame) });
            await this.frames.start(browserId, session.streamId, clientId, events);
        } else {
            this.frames.stop(browserId, clientId);
        }
        return session.info();
    }

    /*
     * The text of a page this machine has open under that node, for an agent a line into it lets
     * read. Null when no client opened one here, which on a desktop is the usual answer: that shell
     * draws the page itself. Whichever client opened it, the page is the same page, so the first
     * session under the id answers.
     */
    async text(browserId: string): Promise<string | null> {
        const session = this.sessionOf(browserId);
        return session ? session.text() : null;
    }

    /*
     * Where the page this machine runs under that node goes next, for an agent that has a line into
     * it. Null when this machine runs none, which in the desktop shell is the usual answer: the page
     * lives in the client there, and `BrowserPages` asks that client instead.
     */
    async drive(browserId: string, action: BrowserDriveAction): Promise<BrowserInfo | null> {
        const session = this.sessionOf(browserId);
        if (!session) {
            return null;
        }
        if (action.kind === 'go') {
            await session.navigate(action.url);
        } else if (action.kind === 'reload') {
            await session.command('reload', action.ignoreCache);
        } else if (action.kind === 'back' || action.kind === 'forward' || action.kind === 'stop') {
            await session.command(action.kind);
        }
        return session.info();
    }

    /* A png of the page this machine runs under that node; null when it runs none. */
    async capture(browserId: string): Promise<Uint8Array | null> {
        const session = this.sessionOf(browserId);
        return session ? session.capture() : null;
    }

    /* Whichever client opened it, the page under one node is one page, so the first session answers. */
    private sessionOf(browserId: string): BrowserSession | undefined {
        return [...this.sessions.values()].find((candidate) => candidate.id === browserId);
    }

    detach(browserId: string, clientId: string): void {
        this.sessions.get(sessionKey(browserId, clientId))?.clients.delete(clientId);
        this.frames.stop(browserId, clientId);
    }

    detachAll(clientId: string): void {
        for (const [key, session] of [...this.sessions]) {
            if (session.clientId === clientId) {
                this.destroy(key, session);
            }
        }
    }

    async navigate(browserId: string, clientId: string, url: string): Promise<BrowserInfo> {
        const session = this.require(browserId, clientId);
        await session.navigate(url);
        return session.info();
    }

    async command(browserId: string, clientId: string, command: 'back' | 'forward' | 'reload' | 'stop', ignoreCache?: boolean): Promise<BrowserInfo> {
        const session = this.require(browserId, clientId);
        await session.command(command, ignoreCache);
        return session.info();
    }

    async resize(browserId: string, clientId: string, width: number, height: number, deviceScaleFactor = 1): Promise<void> {
        await this.require(browserId, clientId).resize(width, height, deviceScaleFactor);
    }

    async input(browserId: string, clientId: string, input: BrowserInput): Promise<void> {
        await this.require(browserId, clientId).input(input);
    }

    kill(browserId: string, clientId: string): void {
        const key = sessionKey(browserId, clientId);
        const session = this.sessions.get(key);
        if (!session) {
            return;
        }
        this.destroy(key, session);
    }

    closeAll(): void {
        for (const [key, session] of [...this.sessions]) {
            this.destroy(key, session);
        }
    }

    private require(browserId: string, clientId: string): BrowserSession {
        const session = this.sessions.get(sessionKey(browserId, clientId));
        if (!session) {
            throw new BrowserError('browser-not-found', 'This browser page is not running');
        }
        return session;
    }

    private broadcast(session: BrowserSession, info: BrowserInfo): void {
        for (const clientId of session.clients) {
            this.sinks.to(clientId, {
                event: 'browser.status',
                payload: info
            });
        }
    }

    private destroy(key: string, session: BrowserSession): void {
        this.sessions.delete(key);
        this.frames.stop(session.id, session.clientId);
        this.unregisterStreams.get(key)?.();
        this.unregisterStreams.delete(key);
        session.close();
    }
}

const sessionKey = (browserId: string, clientId: string): string => streamKeyOf(clientId, browserId);

const eventFrame = (browserId: string, frame: LiveStreamFrame): BrowserFrame => ({
    browserId,
    sequence: frame.sequence,
    width: frame.width,
    height: frame.height,
    data: Buffer.from(frame.data).toString('base64')
});
