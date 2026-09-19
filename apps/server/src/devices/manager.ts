import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type { DeviceAction, DeviceFrame, DeviceInfo, DeviceInput, DeviceOpenResult, DevicePlatform, DeviceSettings, LiveStreamFrame } from '@ruimte/contracts';
import type { SessionSink } from '../sessions/manager.ts';
import { LiveStreamHub, type LiveFrameSource } from '../streams/live-stream.ts';

export interface DeviceSource extends LiveFrameSource {
    input(input: DeviceInput): void | Promise<void>;
}

export interface DeviceBackend {
    readonly id: string;
    readonly platform: DevicePlatform;
    list(): Promise<DeviceInfo[]>;
    boot?(deviceId: string): Promise<DeviceInfo>;
    shutdown?(deviceId: string): Promise<DeviceInfo>;
    detail?(deviceId: string): Promise<DeviceSettings>;
    action?(deviceId: string, action: DeviceAction): Promise<DeviceSettings>;
    createSource?(deviceId: string): DeviceSource;
}

interface DeviceSession {
    clients: Set<string>;
    info: DeviceInfo;
    source: DeviceSource;
    streamId: string;
    unregister: () => void;
}

interface FrameSubscription {
    cancelled: boolean;
    release: (() => void) | null;
}

export class DeviceError extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'DeviceError';
        this.code = code;
    }
}

export class DeviceManager {
    readonly streams: LiveStreamHub;
    private readonly backends: Map<string, DeviceBackend>;
    private readonly sessions = new Map<string, DeviceSession>();
    private readonly sinks = new Map<string, SessionSink>();
    private readonly frameSubscriptions = new Map<string, Map<string, FrameSubscription>>();

    constructor(backends: DeviceBackend[], streams = new LiveStreamHub()) {
        this.backends = new Map(backends.map((backend) => [backend.id, backend]));
        this.streams = streams;
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        // A client that subscribes again before it unsubscribes keeps its newer sink.
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    async list(): Promise<DeviceInfo[]> {
        const results = await Promise.allSettled([...this.backends.values()].map((backend) => backend.list()));
        const devices = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
        const failure = results.find((result) => result.status === 'rejected');
        if (devices.length === 0 && results.length > 0 && results.every((result) => result.status === 'rejected') && failure?.status === 'rejected') {
            throw failure.reason;
        }
        return devices.sort((left, right) => left.name.localeCompare(right.name) || left.runtime.localeCompare(right.runtime));
    }

    async boot(backendId: string, platform: DevicePlatform, deviceId: string): Promise<DeviceInfo> {
        const backend = this.backend(backendId, platform);
        if (!backend.boot) {
            throw new DeviceError('device-action-unavailable', 'This device cannot be started by Ruimte');
        }
        return backend.boot(deviceId);
    }

    async shutdown(backendId: string, platform: DevicePlatform, deviceId: string): Promise<DeviceInfo> {
        const backend = this.backend(backendId, platform);
        if (!backend.shutdown) {
            throw new DeviceError('device-action-unavailable', 'This device cannot be shut down by Ruimte');
        }
        this.destroy(sessionKey(backendId, deviceId));
        return backend.shutdown(deviceId);
    }

    async detail(backendId: string, platform: DevicePlatform, deviceId: string): Promise<DeviceSettings> {
        const backend = this.backend(backendId, platform);
        if (!backend.detail) {
            throw new DeviceError('device-tools-unavailable', 'This device does not expose simulator tools');
        }
        return backend.detail(deviceId);
    }

    async action(action: DeviceAction): Promise<DeviceSettings> {
        const backend = this.backend(action.backendId, action.platform);
        if (!backend.action) {
            throw new DeviceError('device-tools-unavailable', 'This device does not expose simulator tools');
        }
        return backend.action(action.deviceId, action);
    }

    async open(backendId: string, platform: DevicePlatform, deviceId: string, clientId: string, stream: 'http' | 'events' = 'http'): Promise<DeviceOpenResult> {
        const key = sessionKey(backendId, deviceId);
        let session = this.sessions.get(key);
        if (!session) {
            const backend = this.backend(backendId, platform);
            if (!backend.createSource) {
                throw new DeviceError('device-capture-unavailable', 'Device capture is not installed on this machine');
            }
            const device = (await backend.list()).find((candidate) => candidate.deviceId === deviceId);
            if (!device) {
                throw new DeviceError('device-not-found', 'The device is no longer available');
            }
            if (device.state !== 'booted') {
                throw new DeviceError('device-not-booted', 'Start the simulator before opening it');
            }
            let source: DeviceSource;
            try {
                source = backend.createSource(deviceId);
            } catch (error) {
                throw this.sourceError(error);
            }
            const streamId = `device:${randomUUID()}`;
            session = { clients: new Set(), info: device, source, streamId, unregister: () => undefined };
            session.unregister = this.streams.register(streamId, source);
            this.sessions.set(key, session);
        }
        session.clients.add(clientId);
        try {
            if (stream === 'events') {
                await this.startFrameEvents(session, clientId);
            } else {
                this.stopFrameEvents(key, clientId);
            }
        } catch (error) {
            session.clients.delete(clientId);
            throw error;
        }
        return { ...session.info, streamId: session.streamId };
    }

    detach(backendId: string, deviceId: string, clientId: string): void {
        const key = sessionKey(backendId, deviceId);
        this.sessions.get(key)?.clients.delete(clientId);
        this.stopFrameEvents(key, clientId);
    }

    detachAll(clientId: string): void {
        for (const [key, session] of [...this.sessions]) {
            session.clients.delete(clientId);
            this.stopFrameEvents(key, clientId);
            // The source keeps producing frames while it is registered, so the last client leaving ends the session.
            if (session.clients.size === 0) {
                this.destroy(key);
            }
        }
    }

    async input(backendId: string, deviceId: string, clientId: string, input: DeviceInput): Promise<void> {
        const session = this.sessions.get(sessionKey(backendId, deviceId));
        if (!session || !session.clients.has(clientId)) {
            throw new DeviceError('device-not-open', 'Open the device before sending input');
        }
        try {
            await session.source.input(input);
        } catch (error) {
            throw this.sourceError(error);
        }
    }

    closeAll(): void {
        for (const key of [...this.sessions.keys()]) {
            this.destroy(key);
        }
    }

    private backend(backendId: string, platform: DevicePlatform): DeviceBackend {
        const backend = this.backends.get(backendId);
        if (!backend || backend.platform !== platform) {
            throw new DeviceError('platform-unavailable', `${platform === 'ios' ? 'iOS' : 'Android'} simulators are not available on this machine`);
        }
        return backend;
    }

    private async startFrameEvents(session: DeviceSession, clientId: string): Promise<void> {
        const key = sessionKey(session.info.backendId, session.info.deviceId);
        this.stopFrameEvents(key, clientId);
        const subscription: FrameSubscription = { cancelled: false, release: null };
        const byClient = this.frameSubscriptions.get(key) ?? new Map<string, FrameSubscription>();
        byClient.set(clientId, subscription);
        this.frameSubscriptions.set(key, byClient);
        try {
            const release = await this.streams.subscribe(session.streamId, (frame) => {
                if (!subscription.cancelled) {
                    this.sinks.get(clientId)?.({ event: 'device.frame', payload: eventFrame(session.info, frame) });
                }
            });
            if (subscription.cancelled) {
                release();
            } else {
                subscription.release = release;
            }
        } catch (error) {
            byClient.delete(clientId);
            if (byClient.size === 0) {
                this.frameSubscriptions.delete(key);
            }
            throw this.sourceError(error);
        }
    }

    private stopFrameEvents(key: string, clientId: string): void {
        const byClient = this.frameSubscriptions.get(key);
        const subscription = byClient?.get(clientId);
        if (!byClient || !subscription) {
            return;
        }
        subscription.cancelled = true;
        subscription.release?.();
        byClient.delete(clientId);
        if (byClient.size === 0) {
            this.frameSubscriptions.delete(key);
        }
    }

    private destroy(key: string): void {
        const session = this.sessions.get(key);
        if (!session) {
            return;
        }
        this.sessions.delete(key);
        for (const clientId of [...session.clients]) {
            this.stopFrameEvents(key, clientId);
        }
        session.unregister();
    }

    private sourceError(error: unknown): DeviceError {
        if (error instanceof DeviceError) {
            return error;
        }
        if (error instanceof Error && 'code' in error && typeof error.code === 'string') {
            return new DeviceError(error.code, error.message);
        }
        return new DeviceError('device-helper-failed', error instanceof Error ? error.message : 'The device capture helper failed');
    }
}

const sessionKey = (backendId: string, deviceId: string): string => JSON.stringify([backendId, deviceId]);

const eventFrame = (device: DeviceInfo, frame: LiveStreamFrame): DeviceFrame => ({
    deviceId: device.deviceId,
    backendId: device.backendId,
    platform: device.platform,
    sequence: frame.sequence,
    width: frame.width,
    height: frame.height,
    ...(frame.format ? { format: frame.format } : {}),
    data: Buffer.from(frame.data).toString('base64')
});
