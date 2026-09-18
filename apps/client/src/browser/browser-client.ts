import type { BrowserInfo, BrowserInput } from '@ruimte/contracts';
import { endpointKey } from '@/state/keys';
import { useBrowser } from './registry';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';

interface MountedBrowser {
    refs: number;
    url: string;
    width: number;
    height: number;
    attached: boolean;
}

const connectionLost = (error: unknown): boolean => error instanceof TransportError && (error.code === 'not-connected' || error.code === 'disconnected');

export class BrowserClient {
    private readonly mounted = new Map<string, MountedBrowser>();
    private readonly unsubscribe: Array<() => void>;
    readonly endpointId: string;
    private readonly transport: Transport;

    constructor(endpointId: string, transport: Transport) {
        this.endpointId = endpointId;
        this.transport = transport;
        this.unsubscribe = [transport.on('browser.status', (info) => this.apply(info)), transport.subscribeStatus((status) => this.onStatus(status))];
    }

    async open(browserId: string, url: string, width: number, height: number): Promise<void> {
        const current = this.mounted.get(browserId);
        if (current) {
            current.refs += 1;
            current.width = width;
            current.height = height;
            await this.resize(browserId, width, height);
            return;
        }
        const mounted: MountedBrowser = { refs: 1, url, width, height, attached: false };
        this.mounted.set(browserId, mounted);
        try {
            const info = await this.transport.request('browser.open', { browserId, url, width, height });
            mounted.attached = true;
            this.apply(info);
        } catch (error) {
            if (!connectionLost(error)) {
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

    async resize(browserId: string, width: number, height: number): Promise<void> {
        const mounted = this.mounted.get(browserId);
        if (!mounted) {
            return;
        }
        mounted.width = width;
        mounted.height = height;
        await this.transport.request('browser.resize', { browserId, width, height }).catch((error) => {
            if (!connectionLost(error)) {
                this.fail(browserId, error);
            }
        });
    }

    input(browserId: string, input: BrowserInput): void {
        void this.transport.request('browser.input', { browserId, input }).catch((error) => {
            if (!connectionLost(error)) {
                this.fail(browserId, error);
            }
        });
    }

    dispose(): void {
        for (const unsubscribe of this.unsubscribe) {
            unsubscribe();
        }
        this.mounted.clear();
    }

    private apply(info: BrowserInfo): void {
        const mounted = this.mounted.get(info.browserId);
        if (mounted) {
            mounted.url = info.url;
        }
        useBrowser.getState().patch(endpointKey(this.endpointId, info.browserId), {
            url: info.url,
            title: info.title,
            loading: info.loading,
            canGoBack: info.canGoBack,
            canGoForward: info.canGoForward,
            streamError: info.error
        });
    }

    private fail(browserId: string, error: unknown): void {
        useBrowser.getState().patch(endpointKey(this.endpointId, browserId), {
            loading: false,
            streamError: error instanceof Error ? error.message : 'The remote browser failed'
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
                .request('browser.open', { browserId, url: mounted.url, width: mounted.width, height: mounted.height })
                .then((info) => {
                    mounted.attached = true;
                    this.apply(info);
                })
                .catch((error) => {
                    if (!connectionLost(error)) {
                        this.fail(browserId, error);
                    }
                });
        }
    }
}
