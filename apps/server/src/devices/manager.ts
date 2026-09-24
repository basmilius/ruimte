import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import {
    deviceMatches,
    type DeviceAction,
    type DeviceFrame,
    type DeviceInfo,
    type DeviceInput,
    type DeviceKind,
    type DeviceOpenResult,
    type DevicePlatform,
    type DeviceReference,
    type DeviceSettings,
    type DeviceUnavailable,
    type DeviceVideoFormat,
    type LiveStreamFrame
} from '@ruimte/contracts';
import type { SessionEvent, SessionSink } from '../sessions/manager.ts';
import { LiveStreamHub, type LiveFrameSource } from '../streams/live-stream.ts';
import { CodedError } from '../coded-error.ts';
import { FrameFanout, streamKeyOf } from '../streams/frame-fanout.ts';
import { ClientSinks } from '../client-sinks.ts';
import type { DeviceTree } from './device-tree.ts';

export interface DeviceSource extends LiveFrameSource {
    input(input: DeviceInput): void | Promise<void>;
    /* A chord of USB HID keyboard usages, pressed in order and let go in reverse; absent on a source without a keyboard. */
    keys?(usages: readonly number[]): void | Promise<void>;
}

/* Presses a chord on a device through a session held for whoever types. */
export type DeviceKeyboard = (usages: readonly number[]) => Promise<void>;

export interface DeviceBackend {
    readonly id: string;
    readonly platform: DevicePlatform;
    /* The kinds of device this backend finds; absent finds both, so a lookup cannot skip it. */
    readonly kinds?: readonly DeviceKind[];
    list(): Promise<DeviceInfo[]>;
    boot?(deviceId: string): Promise<DeviceInfo>;
    shutdown?(deviceId: string): Promise<DeviceInfo>;
    detail?(deviceId: string): Promise<DeviceSettings>;
    action?(deviceId: string, action: DeviceAction): Promise<DeviceSettings>;
    createSource?(deviceId: string): DeviceSource;
    /* A png of the screen as it is now, at the device's own resolution. */
    screenshot?(deviceId: string): Promise<Uint8Array>;
    /*
     * Types text into whatever has the focus on the device, a newline as Return and a tab as Tab.
     * `keyboard` holds a session and answers its keys, for a backend that types through them.
     */
    type?(deviceId: string, text: string, keyboard: () => Promise<DeviceKeyboard>): Promise<void>;
    /* The accessibility tree of what the device shows now; absent on a backend that cannot read one. */
    tree?(deviceId: string): Promise<DeviceTree>;
    /* Ends whatever `tree` keeps running for this device. */
    closeTree?(deviceId: string): void;
}

interface DeviceSession {
    clients: Set<string>;
    /* The daemon's own holders, each a viewer of the stream, since input only reaches a running source. */
    holds: Map<string, Promise<() => void>>;
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
    'device-tree-failed',
    'device-tree-unavailable',
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
        backend.closeTree?.(deviceId);
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
        const session = await this.sessionFor(backendId, platform, deviceId, formats);
        session.clients.add(clientId);
        try {
            if (stream === 'events') {
                await this.startFrameEvents(session, clientId);
            } else {
                this.frames.stop(sessionKey(backendId, deviceId), clientId);
            }
        } catch (error) {
            session.clients.delete(clientId);
            throw error;
        }
        return { ...session.info, streamId: session.streamId };
    }

    /*
     * A session the daemon keeps for a holder of its own, such as an agent, whether or not a client
     * has the device open; a client that opens it too shares the one session and sees the input live.
     */
    async hold(backendId: string, platform: DevicePlatform, deviceId: string, holderId: string): Promise<DeviceInfo> {
        const key = sessionKey(backendId, deviceId);
        const session = await this.sessionFor(backendId, platform, deviceId, null);
        let holding = session.holds.get(holderId);
        if (!holding) {
            session.clients.add(holderId);
            const subscribed = this.streams.subscribe(session.streamId, () => undefined);
            holding = subscribed;
            session.holds.set(holderId, subscribed);
            subscribed.catch(() => {
                if (session.holds.get(holderId) === subscribed) {
                    session.holds.delete(holderId);
                    this.leave(key, holderId);
                }
            });
        }
        try {
            await holding;
        } catch (error) {
            throw this.sourceError(error);
        }
        return session.info;
    }

    release(backendId: string, deviceId: string, holderId: string): void {
        const key = sessionKey(backendId, deviceId);
        const session = this.sessions.get(key);
        const holding = session?.holds.get(holderId);
        if (!session || !holding) {
            return;
        }
        session.holds.delete(holderId);
        void holding.then(
            (unsubscribe) => unsubscribe(),
            () => undefined
        );
        this.leave(key, holderId);
    }

    /* The device a reference points at on this machine, asking only the backends that could have it; null when none has it. */
    async find(reference: DeviceReference): Promise<DeviceInfo | null> {
        const backends = [...this.backends.values()].filter(
            (backend) => backend.platform === reference.platform && (backend.kinds === undefined || backend.kinds.includes(reference.kind))
        );
        const results = await Promise.allSettled(backends.map((backend) => backend.list()));
        const devices = results.flatMap((result) => (result.status === 'fulfilled' ? result.value : []));
        const found = devices.find((device) => deviceMatches(device, reference));
        if (found) {
            return found;
        }
        const failure = results.find((result) => result.status === 'rejected');
        if (failure?.status === 'rejected') {
            throw this.sourceError(failure.reason);
        }
        return null;
    }

    async screenshot(backendId: string, platform: DevicePlatform, deviceId: string): Promise<Uint8Array> {
        const backend = this.backend(backendId, platform);
        if (!backend.screenshot) {
            throw new DeviceError('device-capture-unavailable', 'This device cannot be photographed by Ruimte');
        }
        try {
            return await backend.screenshot(deviceId);
        } catch (error) {
            throw this.sourceError(error);
        }
    }

    detach(backendId: string, deviceId: string, clientId: string): void {
        const key = sessionKey(backendId, deviceId);
        this.sessions.get(key)?.clients.delete(clientId);
        this.frames.stop(key, clientId);
    }

    detachAll(clientId: string): void {
        for (const key of [...this.sessions.keys()]) {
            this.leave(key, clientId);
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

    async keys(backendId: string, deviceId: string, clientId: string, usages: readonly number[]): Promise<void> {
        const session = this.sessions.get(sessionKey(backendId, deviceId));
        if (!session || !session.clients.has(clientId)) {
            throw new DeviceError('device-not-open', 'Open the device before sending input');
        }
        if (!session.source.keys) {
            throw new DeviceError('device-input-unavailable', 'This device takes no keys from Ruimte');
        }
        try {
            await session.source.keys(usages);
        } catch (error) {
            throw this.sourceError(error);
        }
    }

    /* Whether Ruimte types on this device; a backend that types through keys needs the device to take input. */
    canType(device: DeviceInfo): boolean {
        return this.backends.get(device.backendId)?.type !== undefined && device.capabilities.input;
    }

    async type(backendId: string, platform: DevicePlatform, deviceId: string, text: string, keyboard: () => Promise<DeviceKeyboard>): Promise<void> {
        const backend = this.backend(backendId, platform);
        if (!backend.type) {
            throw new DeviceError('device-input-unavailable', 'Ruimte cannot type on this device');
        }
        try {
            await backend.type(deviceId, text, keyboard);
        } catch (error) {
            throw this.sourceError(error);
        }
    }

    canTree(device: DeviceInfo): boolean {
        return this.backends.get(device.backendId)?.tree !== undefined;
    }

    async tree(backendId: string, platform: DevicePlatform, deviceId: string): Promise<DeviceTree> {
        const backend = this.backend(backendId, platform);
        if (!backend.tree) {
            throw new DeviceError('device-tree-unavailable', 'Ruimte cannot read the accessibility tree of this device');
        }
        try {
            return await backend.tree(deviceId);
        } catch (error) {
            throw this.sourceError(error);
        }
    }

    closeTree(backendId: string, deviceId: string): void {
        this.backends.get(backendId)?.closeTree?.(deviceId);
    }

    closeAll(): void {
        for (const key of [...this.sessions.keys()]) {
            this.destroy(key);
        }
    }

    /* The running session of a device, or a new one; `formats` is what the client that asks can draw, null for a holder that draws nothing. */
    private async sessionFor(
        backendId: string,
        platform: DevicePlatform,
        deviceId: string,
        formats: readonly DeviceVideoFormat[] | null
    ): Promise<DeviceSession> {
        const key = sessionKey(backendId, deviceId);
        const joined = (session: DeviceSession): DeviceSession => {
            if (formats !== null) {
                requireFormat(session.source, formats);
            }
            return session;
        };
        const running = this.sessions.get(key);
        if (running) {
            return joined(running);
        }
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
        // Another open may have made the session while this one listed the devices.
        const raced = this.sessions.get(key);
        if (raced) {
            return joined(raced);
        }
        let source: DeviceSource;
        try {
            source = backend.createSource(deviceId);
        } catch (error) {
            throw this.sourceError(error);
        }
        if (formats !== null) {
            requireFormat(source, formats);
        }
        const streamId = `device:${randomUUID()}`;
        const session: DeviceSession = { clients: new Set(), holds: new Map(), info: device, source, streamId, unregister: () => undefined };
        session.unregister = this.streams.register(streamId, source);
        this.sessions.set(key, session);
        return session;
    }

    /* One client or holder out; the source keeps producing frames while it is registered, so the last one leaving ends the session. */
    private leave(key: string, clientId: string): void {
        const session = this.sessions.get(key);
        if (!session) {
            return;
        }
        session.clients.delete(clientId);
        this.frames.stop(key, clientId);
        if (session.clients.size === 0) {
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
