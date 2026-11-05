import { MountedRegistry, type MountedEntry } from '@adecore/agents-react';
import { messageOf } from '@adecore/ui';
import type { BrowserInfo, BrowserInput, LiveFrameHeader, LiveStreamFrame } from '@ruimte/contracts';
import i18next from 'i18next';
import { eventStreamFields, LatestFrames } from '@/clients/devices/latest-frames';
import { endpointKey } from '@/state/keys';
import { decodeBase64 } from '@/transport-api/piece';
import { isConnectionError, type Transport, type TransportStatus } from '@/transport-api/transport';
import { useBrowser } from './registry';

interface MountedBrowser extends MountedEntry {
    refs: number;
    url: string;
    width: number;
    height: number;
    deviceScaleFactor: number;
    stream: 'http' | 'events';
}

export class BrowserClient {
    private readonly frames = new LatestFrames();
    private readonly mounted = new MountedRegistry<MountedBrowser>();
    private readonly unsubscribe: Array<() => void>;
    readonly endpointId: string;
    private readonly transport: Transport;

    constructor(endpointId: string, transport: Transport) {
        this.endpointId = endpointId;
        this.transport = transport;
        this.unsubscribe = [
            transport.on('browser.status', (info) => this.apply(info)),
            transport.on('browser.frame', ({ data, ...header }) => this.receiveFrame(header, decodeBase64(data))),
            transport.onLiveFrame?.('browser.frame', (header, bytes) => this.receiveFrame(header, bytes)) ?? (() => undefined),
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
            if (this.mounted.get(browserId) !== mounted) {
                this.detachIfGone(browserId);
                return;
            }
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
        this.frames.forget(browserId);
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
        return this.frames.listen(browserId, handler);
    }

    dispose(): void {
        for (const unsubscribe of this.unsubscribe) {
            unsubscribe();
        }
        this.mounted.clear();
        this.frames.clear();
    }

    private apply(info: BrowserInfo): void {
        const mounted = this.mounted.get(info.browserId);
        const blankMismatch = mounted !== undefined && info.url === 'about:blank' && mounted.url !== 'about:blank';
        if (mounted && !blankMismatch) {
            mounted.url = info.url;
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
            streamError: messageOf(error, i18next.t('browser:stream.failed'))
        });
    }

    private onStatus(status: TransportStatus): void {
        if (status !== 'open') {
            this.mounted.detachAll();
            return;
        }
        void this.mounted.reattachAll((browserId, mounted) => this.reopen(browserId, mounted));
    }

    private async reopen(browserId: string, mounted: MountedBrowser): Promise<void> {
        try {
            const info = await this.transport.request('browser.open', this.openPayload(browserId, mounted));
            // The node may have left the canvas while the reopen was on the wire.
            if (this.mounted.get(browserId) !== mounted) {
                this.detachIfGone(browserId);
                return;
            }
            mounted.attached = true;
            this.apply(info);
        } catch (error) {
            if (!isConnectionError(error)) {
                this.fail(browserId, error);
            }
        }
    }

    /* The page opened after its node left, when the detach had nothing to detach yet. A node mounted again since keeps it. */
    private detachIfGone(browserId: string): void {
        if (!this.mounted.has(browserId)) {
            void this.transport.request('browser.detach', { browserId }).catch(() => undefined);
        }
    }

    private openPayload(browserId: string, mounted: MountedBrowser) {
        return {
            browserId,
            url: mounted.url,
            width: mounted.width,
            height: mounted.height,
            deviceScaleFactor: mounted.deviceScaleFactor,
            ...eventStreamFields(mounted.stream, this.transport)
        };
    }

    private receiveFrame(frame: LiveFrameHeader<'browser.frame'>, data: Uint8Array): void {
        const mounted = this.mounted.get(frame.browserId);
        if (!mounted || mounted.stream !== 'events') {
            return;
        }
        this.frames.push(frame.browserId, { sequence: frame.sequence, width: frame.width, height: frame.height, data });
    }
}
