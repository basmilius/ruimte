import type { BrowserFrame, BrowserInfo, BrowserInput, LiveStreamFrame } from '@ruimte/contracts';
import i18next from 'i18next';
import { endpointKey } from '@/state/keys';
import { useBrowser } from './registry';
import { isConnectionError, type Transport, type TransportStatus } from '@/transport/transport';

interface MountedBrowser {
    refs: number;
    url: string;
    width: number;
    height: number;
    deviceScaleFactor: number;
    attached: boolean;
    stream: 'http' | 'events';
}

export class BrowserClient {
    private readonly frameHandlers = new Map<string, Set<(frame: LiveStreamFrame) => void>>();
    private readonly latestFrames = new Map<string, LiveStreamFrame>();
    private readonly mounted = new Map<string, MountedBrowser>();
    private readonly unsubscribe: Array<() => void>;
    readonly endpointId: string;
    private readonly transport: Transport;

    constructor(endpointId: string, transport: Transport) {
        this.endpointId = endpointId;
        this.transport = transport;
        this.unsubscribe = [
            transport.on('browser.status', (info) => this.apply(info)),
            transport.on('browser.frame', (frame) => this.receiveFrame(frame)),
            transport.subscribeStatus((status) => this.onStatus(status))
        ];
    }

    async open(browserId: string, url: string, width: number, height: number, stream: 'http' | 'events' = 'http', deviceScaleFactor = 1): Promise<void> {
        const current = this.mounted.get(browserId);
        if (current) {
            current.refs += 1;
            current.width = width;
            current.height = height;
            current.deviceScaleFactor = deviceScaleFactor;
            if (current.stream !== stream) {
                current.stream = stream;
                const info = await this.transport.request('browser.open', this.openPayload(browserId, current));
                current.attached = true;
                this.apply(info);
                return;
            }
            await this.resize(browserId, width, height, deviceScaleFactor);
            return;
        }
        const mounted: MountedBrowser = {
            refs: 1,
            url,
            width,
            height,
            deviceScaleFactor,
            attached: false,
            stream
        };
        this.mounted.set(browserId, mounted);
        try {
            const info = await this.transport.request('browser.open', this.openPayload(browserId, mounted));
            mounted.attached = true;
            this.apply(info);
        } catch (error) {
            if (!isConnectionError(error)) {
                if (this.mounted.get(browserId) === mounted) {
                    this.mounted.delete(browserId);
                }
                this.fail(browserId, error);
                throw error;
            }
        }
    }

    async detach(browserId: string): Promise<void> {
        const mounted = this.mounted.get(browserId);
        if (!mounted) {
            return;
        }
        mounted.refs -= 1;
        if (mounted.refs > 0) {
            return;
        }
        this.mounted.delete(browserId);
        this.latestFrames.delete(browserId);
        if (!mounted.attached) {
            return;
        }
        await this.transport.request('browser.detach', { browserId }).catch(() => undefined);
    }

    async kill(browserId: string): Promise<void> {
        this.mounted.delete(browserId);
        useBrowser.getState().forget(endpointKey(this.endpointId, browserId));
        await this.transport.request('browser.kill', { browserId }).catch(() => undefined);
    }

    navigate(browserId: string, url: string): void {
        const mounted = this.mounted.get(browserId);
        if (mounted) {
            mounted.url = url;
        }
        void this.transport.request('browser.navigate', { browserId, url }).then(
            (info) => this.apply(info),
            (error) => this.fail(browserId, error)
        );
    }

    command(browserId: string, command: 'back' | 'forward' | 'reload' | 'stop', ignoreCache?: boolean): void {
        void this.transport.request('browser.command', { browserId, command, ignoreCache }).then(
            (info) => this.apply(info),
            (error) => this.fail(browserId, error)
        );
    }

    async resize(browserId: string, width: number, height: number, deviceScaleFactor?: number): Promise<void> {
        const mounted = this.mounted.get(browserId);
        if (!mounted) {
            return;
        }
        mounted.width = width;
        mounted.height = height;
        mounted.deviceScaleFactor = deviceScaleFactor ?? mounted.deviceScaleFactor;
        await this.transport.request('browser.resize', { browserId, width, height, deviceScaleFactor: mounted.deviceScaleFactor }).catch((error) => {
            if (!isConnectionError(error)) {
                this.fail(browserId, error);
            }
        });
    }

    input(browserId: string, input: BrowserInput): void {
        void this.transport.request('browser.input', { browserId, input }).catch((error) => {
            if (!isConnectionError(error)) {
                this.fail(browserId, error);
            }
        });
    }

    onFrame(browserId: string, handler: (frame: LiveStreamFrame) => void): () => void {
        const handlers = this.frameHandlers.get(browserId) ?? new Set<(frame: LiveStreamFrame) => void>();
        handlers.add(handler);
        this.frameHandlers.set(browserId, handlers);
        const latest = this.latestFrames.get(browserId);
        if (latest) {
            handler(latest);
        }
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.frameHandlers.delete(browserId);
            }
        };
    }

    dispose(): void {
        for (const unsubscribe of this.unsubscribe) {
            unsubscribe();
        }
        this.mounted.clear();
        this.frameHandlers.clear();
        this.latestFrames.clear();
    }

    private apply(info: BrowserInfo): void {
        const mounted = this.mounted.get(info.browserId);
        const blankMismatch = mounted !== undefined && info.url === 'about:blank' && mounted.url !== 'about:blank';
        if (mounted) {
            if (!blankMismatch) {
                mounted.url = info.url;
            }
        }
        useBrowser.getState().patch(endpointKey(this.endpointId, info.browserId), {
            url: blankMismatch ? mounted.url : info.url,
            title: info.title,
            loading: info.loading,
            canGoBack: info.canGoBack,
            canGoForward: info.canGoForward,
            streamError: info.error,
            ...('streamId' in info ? { streamId: info.streamId ?? null } : {}),
            ...('favicon' in info ? { favicon: info.favicon ?? null } : {})
        });
    }

    private fail(browserId: string, error: unknown): void {
        useBrowser.getState().patch(endpointKey(this.endpointId, browserId), {
            loading: false,
            streamError: error instanceof Error ? error.message : i18next.t('browser:stream.failed')
        });
    }

    private onStatus(status: TransportStatus): void {
        if (status !== 'open') {
            for (const mounted of this.mounted.values()) {
                mounted.attached = false;
            }
            return;
        }
        for (const [browserId, mounted] of this.mounted) {
            void this.transport
                .request('browser.open', this.openPayload(browserId, mounted))
                .then((info) => {
                    // The node may have left the canvas while the reopen was on the wire.
                    if (!this.mounted.has(browserId)) {
                        return;
                    }
                    mounted.attached = true;
                    this.apply(info);
                })
                .catch((error) => {
                    if (!isConnectionError(error)) {
                        this.fail(browserId, error);
                    }
                });
        }
    }

    private openPayload(browserId: string, mounted: MountedBrowser) {
        return {
            browserId,
            url: mounted.url,
            width: mounted.width,
            height: mounted.height,
            deviceScaleFactor: mounted.deviceScaleFactor,
            ...(mounted.stream === 'events' ? { stream: 'events' as const } : {})
        };
    }

    private receiveFrame(frame: BrowserFrame): void {
        const mounted = this.mounted.get(frame.browserId);
        if (!mounted || mounted.stream !== 'events') {
            return;
        }
        const binary = atob(frame.data);
        const data = Uint8Array.from(binary, (character) => character.charCodeAt(0));
        const decoded: LiveStreamFrame = {
            sequence: frame.sequence,
            width: frame.width,
            height: frame.height,
            data
        };
        this.latestFrames.set(frame.browserId, decoded);
        for (const handler of this.frameHandlers.get(frame.browserId) ?? []) {
            handler(decoded);
        }
    }
}
