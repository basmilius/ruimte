import i18next from 'i18next';
import type {
    DeviceAction,
    DeviceCaptureResult,
    DeviceDetail,
    DeviceInfo,
    DeviceInput,
    DeviceRecordResult,
    DeviceVideoFormat,
    LiveFrameHeader,
    LiveStreamFrame
} from '@ruimte/contracts';
import { powerKey, useDevicePowers } from '@/devices/device-power';
import { useDevices } from '@/devices/state';
import { machineAnswers } from '@/transport/features';
import { HandlerTable } from '@/transport/handler-table';
import { decodeBase64 } from '@/transport/piece';
import { MountedRegistry, type MountedEntry } from '@adecore/agents-react';
import { isConnectionError, type Transport, type TransportStatus } from '@/transport/transport';

interface MountedDevice extends MountedEntry {
    refs: number;
    device: DeviceTarget;
    stream: 'http' | 'events';
    streamId: string | null;
}

const DEVICE_REFRESH_MS = 1_000;
const POWER_REFRESH_MS = 60_000;
const DRAWABLE_FORMATS: DeviceVideoFormat[] = ['jpeg', 'hevc', 'h264'];
export type DeviceTarget = Pick<DeviceInfo, 'backendId' | 'platform' | 'deviceId'>;

function keyOf(device: Pick<DeviceInfo, 'backendId' | 'deviceId'>): string {
    return `${device.backendId}:${device.deviceId}`;
}
function targetOf(device: DeviceTarget) {
    return { backendId: device.backendId, platform: device.platform, deviceId: device.deviceId };
}

export class DeviceClient {
    private readonly frameHandlers = new HandlerTable<LiveStreamFrame>();
    private readonly latestFrames = new Map<string, LiveStreamFrame>();
    private readonly mounted = new MountedRegistry<MountedDevice>();
    private readonly powerWatches = new Map<string, { refs: number; timer: ReturnType<typeof setInterval> }>();
    private refreshInFlight: Promise<DeviceInfo[]> | null = null;
    private refreshTimer: ReturnType<typeof setInterval> | null = null;
    private readonly streamHandlers = new HandlerTable<string>();
    private readonly unsubscribe: Array<() => void>;
    private watchers = 0;
    readonly endpointId: string;
    private readonly transport: Transport;

    constructor(endpointId: string, transport: Transport) {
        this.endpointId = endpointId;
        this.transport = transport;
        this.unsubscribe = [
            transport.on('device.frame', ({ data, ...header }) => this.receiveFrame(header, decodeBase64(data))),
            transport.onLiveFrame?.('device.frame', (header, bytes) => this.receiveFrame(header, bytes)) ?? (() => undefined),
            transport.subscribeStatus((status) => this.onStatus(status))
        ];
    }

    async refresh(background = false): Promise<DeviceInfo[]> {
        if (this.refreshInFlight) {
            return this.refreshInFlight;
        }
        const task = this.readDevices(background);
        this.refreshInFlight = task;
        try {
            return await task;
        } finally {
            if (this.refreshInFlight === task) {
                this.refreshInFlight = null;
            }
        }
    }

    watch(): () => void {
        this.watchers += 1;
        if (this.watchers === 1) {
            const loaded = useDevices.getState().byEndpoint[this.endpointId]?.loaded === true;
            void this.refresh(loaded).catch(() => undefined);
            this.refreshTimer = setInterval(() => void this.refresh(true).catch(() => undefined), DEVICE_REFRESH_MS);
        }
        let watching = true;
        return () => {
            if (!watching) {
                return;
            }
            watching = false;
            this.watchers = Math.max(0, this.watchers - 1);
            if (this.watchers === 0 && this.refreshTimer !== null) {
                clearInterval(this.refreshTimer);
                this.refreshTimer = null;
            }
        };
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
        const detail = await this.transport.request('device.action', action);
        if ((action.action === 'setBattery' || action.action === 'resetBattery') && this.powerWatches.has(keyOf(action))) {
            void this.readPower(action);
        }
        return detail;
    }

    /*
     * A phone's battery, read now and once a minute while anything on screen shows it, and never
     * while nothing does. Every watcher of one device shares one timer.
     */
    watchPower(device: DeviceTarget): () => void {
        const key = keyOf(device);
        const current = this.powerWatches.get(key);
        if (current) {
            current.refs += 1;
        } else {
            void this.readPower(device);
            this.powerWatches.set(key, { refs: 1, timer: setInterval(() => void this.readPower(device), POWER_REFRESH_MS) });
        }
        let watching = true;
        return () => {
            const watch = this.powerWatches.get(key);
            if (!watching || watch === undefined) {
                return;
            }
            watching = false;
            watch.refs -= 1;
            if (watch.refs === 0) {
                clearInterval(watch.timer);
                this.powerWatches.delete(key);
            }
        };
    }

    private async readPower(device: DeviceTarget): Promise<void> {
        if (!machineAnswers(this.transport.connection, 'device.power')) {
            return;
        }
        const key = powerKey(this.endpointId, device);
        try {
            const { power } = await this.transport.request('device.power', targetOf(device));
            useDevicePowers.setState({ [key]: power });
        } catch {
            useDevicePowers.setState({ [key]: null });
        }
    }

    async capture(device: DeviceTarget): Promise<DeviceCaptureResult> {
        return this.transport.request('device.capture', targetOf(device));
    }

    async record(device: DeviceTarget, mode: 'start' | 'stop'): Promise<DeviceRecordResult> {
        return this.transport.request('device.record', { ...targetOf(device), mode });
    }

    /* Reads the device clipboard without `text`, and writes it with; answers what it holds after. */
    async clipboard(device: DeviceTarget, text?: string, paste = false): Promise<string> {
        const result = await this.transport.request('device.clipboard', {
            ...targetOf(device),
            ...(text === undefined ? {} : { text }),
            ...(paste ? { paste } : {})
        });
        return result.text;
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
            if (!isConnectionError(error)) {
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
        const stop = this.frameHandlers.listen(key, handler);
        // A view that mounts mid-stream draws the frame that is already in, rather than a blank canvas.
        const latest = this.latestFrames.get(key);
        if (latest) {
            handler(latest);
        }
        return stop;
    }

    onStream(device: DeviceTarget, handler: (streamId: string) => void): () => void {
        const key = keyOf(device);
        const stop = this.streamHandlers.listen(key, handler);
        const streamId = this.mounted.get(key)?.streamId;
        if (streamId) {
            handler(streamId);
        }
        return stop;
    }

    dispose(): void {
        for (const unsubscribe of this.unsubscribe) {
            unsubscribe();
        }
        if (this.refreshTimer !== null) {
            clearInterval(this.refreshTimer);
            this.refreshTimer = null;
        }
        for (const watch of this.powerWatches.values()) {
            clearInterval(watch.timer);
        }
        this.powerWatches.clear();
        this.watchers = 0;
        this.mounted.clear();
        this.frameHandlers.clear();
        this.latestFrames.clear();
        this.streamHandlers.clear();
        useDevices.getState().forget(this.endpointId);
    }

    private async readDevices(background: boolean): Promise<DeviceInfo[]> {
        if (!background) {
            useDevices.getState().setLoading(this.endpointId);
        }
        try {
            const { devices, unavailable } = await this.transport.request('device.list', {});
            useDevices.getState().receive(this.endpointId, devices, unavailable ?? []);
            return devices;
        } catch (error) {
            if (!isConnectionError(error)) {
                useDevices.getState().fail(this.endpointId, messageOf(error, i18next.t('machines:device.listFailed')));
            }
            throw error;
        }
    }

    private async attach(mounted: MountedDevice): Promise<string> {
        const opened = await this.transport.request('device.open', {
            ...targetOf(mounted.device),
            ...(mounted.stream === 'events' ? { stream: 'events' as const, ...(this.transport.onLiveFrame ? { binary: true } : {}) } : {}),
            formats: DRAWABLE_FORMATS
        });
        mounted.attached = true;
        mounted.streamId = opened.streamId;
        mounted.device = opened;
        useDevices.getState().patch(this.endpointId, opened);
        this.streamHandlers.fanOut(keyOf(opened), opened.streamId);
        return opened.streamId;
    }

    private async control(type: 'device.boot' | 'device.shutdown', device: DeviceInfo): Promise<DeviceInfo> {
        const next = await this.transport.request(type, targetOf(device));
        useDevices.getState().patch(this.endpointId, next);
        return next;
    }

    private onStatus(status: TransportStatus): void {
        if (status !== 'open') {
            this.mounted.detachAll();
            return;
        }
        void this.refresh().catch(() => undefined);
        void this.mounted.reattachAll(async (_key, mounted) => {
            await this.attach(mounted);
        });
    }

    private receiveFrame(frame: LiveFrameHeader<'device.frame'>, data: Uint8Array): void {
        const key = keyOf(frame);
        const mounted = this.mounted.get(key);
        if (!mounted || mounted.stream !== 'events') {
            return;
        }
        const decoded = {
            sequence: frame.sequence,
            width: frame.width,
            height: frame.height,
            ...(frame.format ? { format: frame.format } : {}),
            data
        };
        this.latestFrames.set(key, decoded);
        this.frameHandlers.fanOut(key, decoded);
    }
}

function messageOf(error: unknown, fallback: string): string {
    return error instanceof Error ? error.message : fallback;
}
