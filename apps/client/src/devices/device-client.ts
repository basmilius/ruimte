import type { DeviceAction, DeviceDetail, DeviceFrame, DeviceInfo, DeviceInput, LiveStreamFrame } from '@ruimte/contracts';
import { useDevices } from '@/devices/state';
import { TransportError, type Transport, type TransportStatus } from '@/transport/transport';

interface MountedDevice {
    refs: number;
    device: DeviceTarget;
    attached: boolean;
    stream: 'http' | 'events';
    streamId: string | null;
}

const disconnected = (error: unknown): boolean => error instanceof TransportError && (error.code === 'not-connected' || error.code === 'disconnected');
export type DeviceTarget = Pick<DeviceInfo, 'backendId' | 'platform' | 'deviceId'>;

const keyOf = (device: Pick<DeviceInfo, 'backendId' | 'deviceId'>): string => `${device.backendId}:${device.deviceId}`;
const targetOf = (device: DeviceTarget) => ({ backendId: device.backendId, platform: device.platform, deviceId: device.deviceId });

export class DeviceClient {
    private readonly frameHandlers = new Map<string, Set<(frame: LiveStreamFrame) => void>>();
    private readonly latestFrames = new Map<string, LiveStreamFrame>();
    private readonly mounted = new Map<string, MountedDevice>();
    private readonly streamHandlers = new Map<string, Set<(streamId: string) => void>>();
    private readonly unsubscribe: Array<() => void>;
    readonly endpointId: string;
    private readonly transport: Transport;

    constructor(endpointId: string, transport: Transport) {
        this.endpointId = endpointId;
        this.transport = transport;
        this.unsubscribe = [transport.on('device.frame', (frame) => this.receiveFrame(frame)), transport.subscribeStatus((status) => this.onStatus(status))];
    }

    async refresh(): Promise<DeviceInfo[]> {
        useDevices.getState().setLoading(this.endpointId);
        try {
            const { devices } = await this.transport.request('device.list', {});
            useDevices.getState().receive(this.endpointId, devices);
            return devices;
        } catch (error) {
            if (!disconnected(error)) {
                useDevices.getState().fail(this.endpointId, messageOf(error, 'The devices could not be read'));
            }
            throw error;
        }
    }

    async boot(device: DeviceInfo): Promise<DeviceInfo> {
        return this.control('device.boot', device);
    }

    async shutdown(device: DeviceInfo): Promise<DeviceInfo> {
        return this.control('device.shutdown', device);
    }

    async detail(device: DeviceTarget): Promise<DeviceDetail> {
        return this.transport.request('device.detail', targetOf(device));
    }

    async action(action: DeviceAction): Promise<DeviceDetail> {
        return this.transport.request('device.action', action);
    }

    async open(device: DeviceTarget, stream: 'http' | 'events' = 'http'): Promise<string> {
        const key = keyOf(device);
        const current = this.mounted.get(key);
        if (current) {
            current.refs += 1;
            current.device = device;
            if (current.stream === stream && current.attached && current.streamId) {
                return current.streamId;
            }
            current.stream = stream;
            return this.attach(current);
        }
        const mounted: MountedDevice = { refs: 1, device, attached: false, stream, streamId: null };
        this.mounted.set(key, mounted);
        try {
            return await this.attach(mounted);
        } catch (error) {
            if (!disconnected(error)) {
                this.mounted.delete(key);
            }
            throw error;
        }
    }

    async detach(device: DeviceTarget): Promise<void> {
        const key = keyOf(device);
        const mounted = this.mounted.get(key);
        if (!mounted) {
            return;
        }
        mounted.refs -= 1;
        if (mounted.refs > 0) {
            return;
        }
        this.mounted.delete(key);
        this.latestFrames.delete(key);
        if (mounted.attached) {
            await this.transport.request('device.detach', targetOf(mounted.device)).catch(() => undefined);
        }
    }

    input(device: DeviceTarget, input: DeviceInput): void {
        void this.transport.request('device.input', { ...targetOf(device), input }).catch(() => undefined);
    }

    onFrame(device: DeviceTarget, handler: (frame: LiveStreamFrame) => void): () => void {
        const key = keyOf(device);
        const handlers = this.frameHandlers.get(key) ?? new Set<(frame: LiveStreamFrame) => void>();
        handlers.add(handler);
        this.frameHandlers.set(key, handlers);
        const latest = this.latestFrames.get(key);
        if (latest) {
            handler(latest);
        }
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.frameHandlers.delete(key);
            }
        };
    }

    onStream(device: DeviceTarget, handler: (streamId: string) => void): () => void {
        const key = keyOf(device);
        const handlers = this.streamHandlers.get(key) ?? new Set<(streamId: string) => void>();
        handlers.add(handler);
        this.streamHandlers.set(key, handlers);
        const streamId = this.mounted.get(key)?.streamId;
        if (streamId) {
            handler(streamId);
        }
        return () => {
            handlers.delete(handler);
            if (handlers.size === 0) {
                this.streamHandlers.delete(key);
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
        this.streamHandlers.clear();
        useDevices.getState().forget(this.endpointId);
    }

    private async attach(mounted: MountedDevice): Promise<string> {
        const opened = await this.transport.request('device.open', {
            ...targetOf(mounted.device),
            ...(mounted.stream === 'events' ? { stream: 'events' as const } : {})
        });
        mounted.attached = true;
        mounted.streamId = opened.streamId;
        mounted.device = opened;
        useDevices.getState().patch(this.endpointId, opened);
        for (const handler of this.streamHandlers.get(keyOf(opened)) ?? []) {
            handler(opened.streamId);
        }
        return opened.streamId;
    }

    private async control(type: 'device.boot' | 'device.shutdown', device: DeviceInfo): Promise<DeviceInfo> {
        const next = await this.transport.request(type, targetOf(device));
        useDevices.getState().patch(this.endpointId, next);
        return next;
    }

    private onStatus(status: TransportStatus): void {
        if (status !== 'open') {
            for (const mounted of this.mounted.values()) {
                mounted.attached = false;
            }
            return;
        }
        void this.refresh().catch(() => undefined);
        for (const mounted of this.mounted.values()) {
            void this.attach(mounted).catch(() => undefined);
        }
    }

    private receiveFrame(frame: DeviceFrame): void {
        const key = keyOf(frame);
        const mounted = this.mounted.get(key);
        if (!mounted || mounted.stream !== 'events') {
            return;
        }
        const binary = atob(frame.data);
        const decoded = {
            sequence: frame.sequence,
            width: frame.width,
            height: frame.height,
            data: Uint8Array.from(binary, (character) => character.charCodeAt(0))
        };
        this.latestFrames.set(key, decoded);
        for (const handler of this.frameHandlers.get(key) ?? []) {
            handler(decoded);
        }
    }
}

const messageOf = (error: unknown, fallback: string): string => (error instanceof Error ? error.message : fallback);
