import { Buffer } from 'node:buffer';
import { join } from 'node:path';
import type { BrowserInfo, BrowserInput } from '@ruimte/contracts';
import type { SessionSink } from '../sessions/manager.ts';
import { LiveStreamHub, type LiveFrameSource } from '../streams/live-stream.ts';

interface NavigationHistory {
    currentIndex: number;
    entries: unknown[];
}

interface ScreencastFrame {
    data: string;
    metadata?: { deviceWidth?: number; deviceHeight?: number };
    sessionId: number;
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
    cdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T>;
    close(): void;
}

export type BrowserPageFactory = (width: number, height: number) => BrowserPage;

export class BrowserError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'BrowserError';
        this.code = code;
    }
}

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

class BrowserSession implements LiveFrameSource {
    readonly clients = new Set<string>();
    readonly id: string;
    private readonly page: BrowserPage;
    private readonly changed: (state: BrowserInfo) => void;
    private width: number;
    private height: number;
    private state: BrowserInfo;
    private cdpTail = Promise.resolve<unknown>(undefined);
    private publish: ((frame: { sequence: number; width: number; height: number; data: Uint8Array }) => void) | null = null;
    private sequence = 0;
    private streaming = false;

    constructor(id: string, page: BrowserPage, width: number, height: number, changed: (state: BrowserInfo) => void) {
        this.id = id;
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
            error: null
        };
        page.onNavigated = (url, title) => {
            this.state = { ...this.state, url, title: title ?? page.title ?? '', loading: false, error: null };
            this.changed(this.info());
            queueMicrotask(() => {
                this.state = { ...this.state, url: page.url || url, title: page.title ?? '', loading: page.loading };
                this.changed(this.info());
                void this.refreshHistory();
            });
        };
        page.onNavigationFailed = (error) => {
            this.state = { ...this.state, loading: false, error: error.message };
            this.changed(this.info());
        };
        page.addEventListener('Page.screencastFrame', (event) => {
            const frame = event.data;
            this.enqueueCdp('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => undefined);
            if (!this.publish) {
                return;
            }
            this.sequence = (this.sequence + 1) >>> 0;
            this.publish({
                sequence: this.sequence,
                width: Math.round(frame.metadata?.deviceWidth ?? this.width),
                height: Math.round(frame.metadata?.deviceHeight ?? this.height),
                data: Buffer.from(frame.data, 'base64')
            });
        });
    }

    info(): BrowserInfo {
        return { ...this.state };
    }

    async navigate(input: string): Promise<void> {
        const url = normalizeUrl(input);
        this.state = { ...this.state, url, loading: true, error: null };
        this.changed(this.info());
        try {
            await this.page.navigate(url);
            this.state = { ...this.state, url: this.page.url, title: this.page.title ?? '', loading: this.page.loading, error: null };
            this.changed(this.info());
            await this.refreshHistory();
        } catch (error) {
            if (this.state.loading) {
                this.state = { ...this.state, loading: false, error: error instanceof Error ? error.message : 'Page failed to load' };
                this.changed(this.info());
            }
        }
    }

    async resize(width: number, height: number): Promise<void> {
        this.width = width;
        this.height = height;
        await this.page.resize(width, height);
        if (this.streaming) {
            const publish = this.publish!;
            await this.stop();
            await this.start(publish);
        }
    }

    async command(command: 'back' | 'forward' | 'reload' | 'stop', ignoreCache = false): Promise<void> {
        this.state = { ...this.state, loading: command !== 'stop', error: null };
        this.changed(this.info());
        if (command === 'back') {
            await this.page.back();
        } else if (command === 'forward') {
            await this.page.forward();
        } else if (command === 'reload' && !ignoreCache) {
            await this.page.reload();
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
            await this.page.type(input.text);
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
            maxWidth: this.width,
            maxHeight: this.height,
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

    private enqueueCdp<T = unknown>(method: string, params?: Record<string, unknown>): Promise<T> {
        const next = this.cdpTail.then(() => this.page.cdp<T>(method, params));
        this.cdpTail = next.catch(() => undefined);
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
            this.state = { ...this.state, canGoBack: false, canGoForward: false };
        }
    }
}

export class BrowserManager {
    private readonly sessions = new Map<string, BrowserSession>();
    private readonly sinks = new Map<string, SessionSink>();
    private readonly unregisterStreams = new Map<string, () => void>();
    readonly streams: LiveStreamHub;
    private readonly createPage: BrowserPageFactory;

    constructor(streams: LiveStreamHub, createPage: BrowserPageFactory) {
        this.streams = streams;
        this.createPage = createPage;
    }

    static withBun(home: string): BrowserManager {
        const profile = join(home, 'browser');
        return new BrowserManager(
            new LiveStreamHub(),
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
        this.sinks.set(clientId, sink);
        return () => this.sinks.delete(clientId);
    }

    async open(browserId: string, clientId: string, url: string, width: number, height: number): Promise<BrowserInfo> {
        let session = this.sessions.get(browserId);
        if (!session) {
            let page: BrowserPage;
            try {
                page = this.createPage(width, height);
            } catch (error) {
                throw new BrowserError('browser-unavailable', error instanceof Error ? error.message : 'Headless Chrome is not available');
            }
            session = new BrowserSession(browserId, page, width, height, (info) => this.broadcast(session!, info));
            this.sessions.set(browserId, session);
            this.unregisterStreams.set(browserId, this.streams.register(`browser:${browserId}`, session));
            session.clients.add(clientId);
            await session.navigate(url);
            await session.resize(width, height);
        } else {
            session.clients.add(clientId);
            await session.resize(width, height);
        }
        return session.info();
    }

    detach(browserId: string, clientId: string): void {
        this.sessions.get(browserId)?.clients.delete(clientId);
    }

    detachAll(clientId: string): void {
        for (const session of this.sessions.values()) {
            session.clients.delete(clientId);
        }
    }

    async navigate(browserId: string, url: string): Promise<BrowserInfo> {
        const session = this.require(browserId);
        await session.navigate(url);
        return session.info();
    }

    async command(browserId: string, command: 'back' | 'forward' | 'reload' | 'stop', ignoreCache?: boolean): Promise<BrowserInfo> {
        const session = this.require(browserId);
        await session.command(command, ignoreCache);
        return session.info();
    }

    async resize(browserId: string, width: number, height: number): Promise<void> {
        await this.require(browserId).resize(width, height);
    }

    async input(browserId: string, input: BrowserInput): Promise<void> {
        await this.require(browserId).input(input);
    }

    kill(browserId: string): void {
        const session = this.sessions.get(browserId);
        if (!session) {
            return;
        }
        this.sessions.delete(browserId);
        this.unregisterStreams.get(browserId)?.();
        this.unregisterStreams.delete(browserId);
        session.close();
    }

    closeAll(): void {
        for (const browserId of [...this.sessions.keys()]) {
            this.kill(browserId);
        }
    }

    private require(browserId: string): BrowserSession {
        const session = this.sessions.get(browserId);
        if (!session) {
            throw new BrowserError('browser-not-found', 'This browser page is not running');
        }
        return session;
    }

    private broadcast(session: BrowserSession, info: BrowserInfo): void {
        for (const clientId of session.clients) {
            this.sinks.get(clientId)?.({ event: 'browser.status', payload: info });
        }
    }
}
