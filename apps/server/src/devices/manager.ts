import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import type {
    DeviceAction,
    DeviceFrame,
    DeviceInfo,
    DeviceInput,
    DeviceOpenResult,
    DevicePlatform,
    DeviceSettings,
    DeviceUnavailable,
    DeviceVideoFormat,
    LiveStreamFrame
} from '@ruimte/contracts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { LiveStreamHub, type LiveFrameSource } from '../streams/live-stream.ts';
import { CodedError } from '../coded-error.ts';
import { FrameFanout, streamKeyOf } from '../streams/frame-fanout.ts';
import { ClientSinks } from '../client-sinks.ts';

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

/* Every code a device failure reaches a client with, the helper's own among them. */
const DEVICE_ERROR_CODES = [
    'device-action-unavailable',
    'device-capture-failed',
    'device-capture-unavailable',
    'device-input-unavailable',
    'device-not-booted',
    'device-not-found',
    'device-not-open',
    'device-tools-unavailable',
    'platform-unavailable',
    'invalid-devicectl-output',
    'invalid-simctl-output',
    'devicectl-failed',
    'devicectl-unavailable',
    'simctl-failed',
    'simctl-unavailable',
    'device-helper-exited',
    'device-helper-failed',
    'device-helper-native',
    'device-helper-protocol',
    'device-helper-running',
    'device-helper-unavailable',
    'device-not-streaming',
    'device-format-unsupported',
    'adb-unavailable',
    'adb-failed',
    'invalid-adb-output',
    'emulator-unavailable',
    'emulator-failed',
    'scrcpy-unavailable',
    'scrcpy-failed',
    'scrcpy-protocol'
] as const;

export type DeviceErrorCode = (typeof DEVICE_ERROR_CODES)[number];

const isDeviceErrorCode = (code: string): code is DeviceErrorCode => (DEVICE_ERROR_CODES as readonly string[]).includes(code);

export class DeviceError extends CodedError<DeviceErrorCode> {}

/* What a client that names no formats draws, since it predates H.264. */
const FORMATS_BEFORE_H264: readonly DeviceVideoFormat[] = ['jpeg', 'hevc'];

export class DeviceManager {
    readonly streams: LiveStreamHub;
    private readonly backends: Map<string, DeviceBackend>;
    private readonly sessions = new Map<string, DeviceSession>();
    private readonly sinks = new ClientSinks();
    private readonly frames: FrameFanout;

    constructor(backends: DeviceBackend[], streams = new LiveStreamHub()) {
        this.backends = new Map(backends.map((backend) => [backend.id, backend]));
        this.streams = streams;
        this.frames = new FrameFanout(streams, this.sinks);
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    async list(): Promise<DeviceInfo[]> {
        return (await this.survey()).devices;
    }

    /* Every device the backends found, and why the others found nothing. */
    async survey(): Promise<{ devices: DeviceInfo[]; unavailable: DeviceUnavailable[] }> {
        const backends = [...this.backends.values()];
        const results = await Promise.allSettled(backends.map((backend) => backend.list()));
        const devices = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
        const failure = results.find((result) => result.status === 'rejected');
        if (devices.length === 0 && results.length > 0 && results.every((result) => result.status === 'rejected') && failure?.status === 'rejected') {
            throw failure.reason;
        }
        const unavailable = results.flatMap((result, index): DeviceUnavailable[] => {
            if (result.status === 'fulfilled') {
                return [];
            }
            const error = this.sourceError(result.reason);
            return [{ platform: backends[index]!.platform, code: error.code, message: error.message }];
        });
        return {
            devices: devices.sort((left, right) => left.name.localeCompare(right.name) || left.runtime.localeCompare(right.runtime)),
            unavailable
        };
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
            throw new DeviceError('device-tools-unavailable', 'This device has no tools in Ruimte');
        }
        return backend.detail(deviceId);
    }

    async action(action: DeviceAction): Promise<DeviceSettings> {
        const backend = this.backend(action.backendId, action.platform);
        if (!backend.action) {
            throw new DeviceError('device-tools-unavailable', 'This device has no tools in Ruimte');
        }
        return backend.action(action.deviceId, action);
    }

    async open(
        backendId: string,
        platform: DevicePlatform,
        deviceId: string,
        clientId: string,
        stream: 'http' | 'events' = 'http',
        formats: readonly DeviceVideoFormat[] = FORMATS_BEFORE_H264
    ): Promise<DeviceOpenResult> {
        const key = sessionKey(backendId, deviceId);
        let session = this.sessions.get(key);
        if (session) {
            requireFormat(session.source, formats);
        } else {
            const backend = this.backend(backendId, platform);
            if (!backend.createSource) {
                throw new DeviceError('device-capture-unavailable', 'Device capture is not installed on this machine');
            }
            const device = (await backend.list()).find((candidate) => candidate.deviceId === deviceId);
            if (!device) {
                throw new DeviceError('device-not-found', 'The device is no longer available');
            }
            if (device.state !== 'booted') {
                throw new DeviceError('device-not-booted', 'Start the device before opening it');
            }
            let source: DeviceSource;
            try {
                source = backend.createSource(deviceId);
            } catch (error) {
                throw this.sourceError(error);
            }
            requireFormat(source, formats);
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
                this.frames.stop(key, clientId);
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
        this.frames.stop(key, clientId);
    }

    detachAll(clientId: string): void {
        for (const [key, session] of [...this.sessions]) {
            session.clients.delete(clientId);
            this.frames.stop(key, clientId);
            // The source keeps producing frames while it is registered, so the last client leaving ends the session.
            if (session.clients.size === 0) {
                this.destroy(key);
            }
        }
    }

    /* For a client that dropped frames of the video while its link was behind. */
    requestKeyFrame(backendId: string, deviceId: string): void {
        const session = this.sessions.get(sessionKey(backendId, deviceId));
        if (session) {
            this.streams.requestKeyFrame(session.streamId);
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
            throw new DeviceError('platform-unavailable', `${platform === 'ios' ? 'iOS' : 'Android'} devices are not available on this machine`);
        }
        return backend;
    }

    private async startFrameEvents(session: DeviceSession, clientId: string): Promise<void> {
        const key = sessionKey(session.info.backendId, session.info.deviceId);
        const events = (frame: LiveStreamFrame): SessionEvent => ({ event: 'device.frame', payload: eventFrame(session.info, frame) });
        try {
            await this.frames.start(key, session.streamId, clientId, events);
        } catch (error) {
            throw this.sourceError(error);
        }
    }

    private destroy(key: string): void {
        const session = this.sessions.get(key);
        if (!session) {
            return;
        }
        this.sessions.delete(key);
        this.frames.stopAll(key);
        session.unregister();
    }

    private sourceError(error: unknown): DeviceError {
        if (error instanceof DeviceError) {
            return error;
        }
        // The capture helper names its own failures; a code from anywhere else is not one a client knows.
        if (error instanceof Error && 'code' in error && typeof error.code === 'string' && isDeviceErrorCode(error.code)) {
            return new DeviceError(error.code, error.message);
        }
        return new DeviceError('device-helper-failed', error instanceof Error ? error.message : 'The device capture helper failed');
    }
}

const sessionKey = (backendId: string, deviceId: string): string => streamKeyOf(backendId, deviceId);

const requireFormat = (source: DeviceSource, formats: readonly DeviceVideoFormat[]): void => {
    if (!formats.includes(source.format ?? 'jpeg')) {
        throw new DeviceError('device-format-unsupported', 'Update Ruimte on this client to show this device');
    }
};

const eventFrame = (device: DeviceInfo, frame: LiveStreamFrame): DeviceFrame => ({
    deviceId: device.deviceId,
    backendId: device.backendId,
    platform: device.platform,
    sequence: frame.sequence,
    width: frame.width,
    height: frame.height,
    ...(frame.format ? { format: frame.format } : {}),
    ...(frame.keyFrame !== undefined ? { keyFrame: frame.keyFrame } : {}),
    data: Buffer.from(frame.data).toString('base64')
});
