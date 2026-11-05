import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';
import { isAbsolute } from 'node:path';
import {
    deviceMatches,
    type DeviceAction,
    type DeviceInfo,
    type DeviceInput,
    type DeviceKind,
    type DeviceOpenResult,
    type DevicePlatform,
    type DevicePower,
    type DeviceReference,
    type DeviceSettings,
    type DeviceUnavailable,
    type DeviceVideoFormat,
    type LiveFrameHeader,
    type LiveStreamFrame
} from '@ruimte/contracts';
import { LiveSinks, type LiveEvent, type LiveSink } from '../client-sinks.ts';
import { FrameFanout, streamKeyOf } from '../streams/frame-fanout.ts';
import { LiveStreamHub, type LiveFrameSource } from '../streams/live-stream.ts';
import { DeviceError, isDeviceErrorCode } from './device-error.ts';
import { actionPaths } from './device-paths.ts';
import type { DeviceTree } from './device-tree.ts';

export interface DeviceSource extends LiveFrameSource {
    input(input: DeviceInput): void | Promise<void>;
    /* A chord of USB HID keyboard usages, pressed in order and let go in reverse; absent on a source without a keyboard. */
    keys?(usages: readonly number[]): void | Promise<void>;
    /* Puts the text on the device's clipboard and pastes it where the focus is; absent on a source that cannot. */
    paste?(text: string): Promise<void>;
    /* The clipboard through the session, for a device whose clipboard only its screen server reaches. */
    readClipboard?(): Promise<string>;
    writeClipboard?(text: string): Promise<void>;
}

/* The keys and the clipboard of a device, through a session held for whoever types. */
export interface DeviceKeyboard {
    keys(usages: readonly number[]): Promise<void>;
    paste(text: string): Promise<void>;
}

/* USB HID keyboard usages (page 7) of the keys typing presses itself. */
const KEY_RETURN = 0x28;
const KEY_TAB = 0x2b;
export const KEY_V = 0x19;
export const KEY_LEFT_COMMAND = 0xe3;

/* The app reads the clipboard on its own time after a paste, so the next run waits before it writes the clipboard again. */
export const PASTE_SETTLE_MS = 150;

/*
 * Types text a run at a time, a newline as Return and a tab as Tab and every run between them pasted:
 * a key per character would follow the keyboard layout and could not type an accent or an emoji at all.
 */
export async function typeInRuns(text: string, press: (usage: number) => Promise<void>, paste: (run: string) => Promise<void>): Promise<void> {
    for (const part of text.replace(/\r\n?/g, '\n').split(/(\n|\t)/)) {
        if (part === '\n') {
            await press(KEY_RETURN);
        } else if (part === '\t') {
            await press(KEY_TAB);
        } else if (part !== '') {
            await paste(part);
        }
    }
}

export interface DeviceBackend {
    readonly id: string;
    readonly platform: DevicePlatform;
    /* The kinds of device this backend finds; absent finds both, so a lookup cannot skip it. */
    readonly kinds?: readonly DeviceKind[];
    list(): Promise<DeviceInfo[]>;
    boot?(deviceId: string): Promise<DeviceInfo>;
    /* Waits until a started device has finished starting and can be operated; absent on a backend that cannot tell. */
    ready?(deviceId: string): Promise<DeviceInfo>;
    shutdown?(deviceId: string): Promise<DeviceInfo>;
    detail?(deviceId: string): Promise<DeviceSettings>;
    /* `session` is the device's open source, for an action that goes through it; null while nobody has the device open. */
    action?(deviceId: string, action: DeviceAction, session: DeviceSource | null): Promise<DeviceSettings>;
    createSource?(deviceId: string): DeviceSource;
    /* A png of the screen as it is now, at the device's own resolution. */
    screenshot?(deviceId: string): Promise<Uint8Array>;
    /* A png for a person to keep; absent takes `screenshot`. */
    capture?(deviceId: string): Promise<Uint8Array>;
    /* Records the screen into `file`, one recording per device at a time. */
    startRecording?(deviceId: string, file: string): Promise<void>;
    /* Ends the recording, or takes the one that ended on its own, once its file is whole; answers that file. */
    stopRecording?(deviceId: string): Promise<string>;
    /* The clipboard without a session; a backend without it goes through the device's open source. */
    readClipboard?(deviceId: string): Promise<string>;
    writeClipboard?(deviceId: string, text: string): Promise<void>;
    /*
     * Types text into whatever has the focus on the device, a newline as Return and a tab as Tab.
     * `keyboard` holds a session and answers its keys, for a backend that types through them.
     */
    type?(deviceId: string, text: string, keyboard: () => Promise<DeviceKeyboard>): Promise<void>;
    /* The accessibility tree of what the device shows now; absent on a backend that cannot read one. */
    tree?(deviceId: string): Promise<DeviceTree>;
    /* Ends whatever `tree` keeps running for this device. */
    closeTree?(deviceId: string): void;
    /* A phone's own battery; null for a device without one of its own, such as a simulator. */
    power?(deviceId: string): Promise<DevicePower | null>;
    /* Ends what runs beside the sessions (recordings, camera helpers, tree readers), for a daemon that stops. */
    closeAll?(): void;
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

/* What a client that names no formats draws, since it predates H.264. */
const FORMATS_BEFORE_H264: readonly DeviceVideoFormat[] = ['jpeg', 'hevc'];

export class DeviceManager {
    readonly streams: LiveStreamHub;
    private readonly backends: Map<string, DeviceBackend>;
    private readonly sessions = new Map<string, DeviceSession>();
    private readonly sinks = new LiveSinks();
    private readonly frames: FrameFanout;

    private readonly refusePath: (path: string) => Promise<void>;

    /* `refusePath` rejects a path on the machine a device may not be handed, such as the machine's own state. */
    constructor(backends: DeviceBackend[], streams = new LiveStreamHub(), refusePath: (path: string) => Promise<void> = async () => undefined) {
        this.backends = new Map(backends.map((backend) => [backend.id, backend]));
        this.streams = streams;
        this.frames = new FrameFanout(streams, this.sinks);
        this.refusePath = refusePath;
    }

    subscribe(clientId: string, sink: LiveSink): () => void {
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

    /* The device once it can be operated; null from a backend that cannot tell when that is. */
    async ready(backendId: string, platform: DevicePlatform, deviceId: string): Promise<DeviceInfo | null> {
        const backend = this.backend(backendId, platform);

        return backend.ready ? backend.ready(deviceId) : null;
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

    /* Read only and never refused: a device that cannot say, for whatever reason, has an unknown battery. */
    async power(backendId: string, platform: DevicePlatform, deviceId: string): Promise<DevicePower | null> {
        try {
            return (await this.backend(backendId, platform).power?.(deviceId)) ?? null;
        } catch {
            return null;
        }
    }

    async action(action: DeviceAction): Promise<DeviceSettings> {
        const backend = this.backend(action.backendId, action.platform);
        if (!backend.action) {
            throw new DeviceError('device-tools-unavailable', 'This device has no tools in Ruimte');
        }
        for (const path of actionPaths(action)) {
            await this.checkPath(path);
        }
        if (action.action === 'erase') {
            // An erased device shows nothing of before, so nobody keeps watching it.
            this.destroy(sessionKey(action.backendId, action.deviceId));
            backend.closeTree?.(action.deviceId);
        }
        return backend.action(action.deviceId, action, this.sessions.get(sessionKey(action.backendId, action.deviceId))?.source ?? null);
    }

    async open(
        backendId: string,
        platform: DevicePlatform,
        deviceId: string,
        clientId: string,
        stream: 'http' | 'events' = 'http',
        formats: readonly DeviceVideoFormat[] = FORMATS_BEFORE_H264,
        binary = false
    ): Promise<DeviceOpenResult> {
        const session = await this.sessionFor(backendId, platform, deviceId, formats);
        session.clients.add(clientId);
        try {
            if (stream === 'events') {
                await this.startFrameEvents(session, clientId, binary);
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
        const take = backend.screenshot?.bind(backend);
        if (!take) {
            throw new DeviceError('device-capture-unavailable', 'This device cannot be photographed by Ruimte');
        }
        return this.guarded(() => take(deviceId));
    }

    async capture(backendId: string, platform: DevicePlatform, deviceId: string): Promise<Uint8Array> {
        const backend = this.backend(backendId, platform);
        const take = backend.capture?.bind(backend) ?? backend.screenshot?.bind(backend);
        if (!take) {
            throw new DeviceError('device-capture-unavailable', 'This device cannot be photographed by Ruimte');
        }
        return this.guarded(() => take(deviceId));
    }

    async startRecording(backendId: string, platform: DevicePlatform, deviceId: string, file: string): Promise<void> {
        const backend = this.backend(backendId, platform);
        const start = backend.startRecording?.bind(backend);
        if (!start) {
            throw new DeviceError('device-action-unavailable', 'This device cannot be recorded by Ruimte');
        }
        await this.guarded(() => start(deviceId, file));
    }

    async stopRecording(backendId: string, platform: DevicePlatform, deviceId: string): Promise<string> {
        const backend = this.backend(backendId, platform);
        const stop = backend.stopRecording?.bind(backend);
        if (!stop) {
            throw new DeviceError('device-action-unavailable', 'This device cannot be recorded by Ruimte');
        }
        return this.guarded(() => stop(deviceId));
    }

    /*
     * Reads the device clipboard, or writes `text` to it and with `paste` presses paste too; answers
     * what the clipboard holds after. A device whose backend has no clipboard of its own needs to be open.
     */
    async clipboard(backendId: string, platform: DevicePlatform, deviceId: string, clientId: string, text?: string, paste = false): Promise<string> {
        const backend = this.backend(backendId, platform);
        const session = this.sessions.get(sessionKey(backendId, deviceId));
        const source = session?.clients.has(clientId) ? session.source : null;
        return this.guarded(async () => {
            if (text === undefined) {
                return backend.readClipboard ? backend.readClipboard(deviceId) : clipboardOf(source).readClipboard();
            }
            if (paste) {
                await this.pasteInto(backend, deviceId, source, text);
            } else if (backend.writeClipboard) {
                await backend.writeClipboard(deviceId, text);
            } else {
                await clipboardOf(source).writeClipboard(text);
            }
            return text;
        });
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
        const { source } = this.openFor(backendId, deviceId, clientId);
        await this.guarded(async () => source.input(input));
    }

    async keys(backendId: string, deviceId: string, clientId: string, usages: readonly number[]): Promise<void> {
        const { source } = this.openFor(backendId, deviceId, clientId);
        const keys = source.keys?.bind(source);
        if (!keys) {
            throw new DeviceError('device-input-unavailable', 'This device takes no keys from Ruimte');
        }
        await this.guarded(async () => keys(usages));
    }

    async paste(backendId: string, deviceId: string, clientId: string, text: string): Promise<void> {
        const { source } = this.openFor(backendId, deviceId, clientId);
        const paste = source.paste?.bind(source);
        if (!paste) {
            throw new DeviceError('device-input-unavailable', 'This device takes no pasted text from Ruimte');
        }
        await this.guarded(() => paste(text));
    }

    /* The session of a device this client or holder has open. */
    private openFor(backendId: string, deviceId: string, clientId: string): DeviceSession {
        const session = this.sessions.get(sessionKey(backendId, deviceId));
        if (!session || !session.clients.has(clientId)) {
            throw new DeviceError('device-not-open', 'Open the device before sending input');
        }
        return session;
    }

    /* Whether Ruimte types on this device; a backend that types through keys needs the device to take input. */
    canType(device: DeviceInfo): boolean {
        return this.backends.get(device.backendId)?.type !== undefined && device.capabilities.input;
    }

    async type(backendId: string, platform: DevicePlatform, deviceId: string, text: string, keyboard: () => Promise<DeviceKeyboard>): Promise<void> {
        const backend = this.backend(backendId, platform);
        const type = backend.type?.bind(backend);
        if (!type) {
            throw new DeviceError('device-input-unavailable', 'Ruimte cannot type on this device');
        }
        await this.guarded(() => type(deviceId, text, keyboard));
    }

    canTree(device: DeviceInfo): boolean {
        return this.backends.get(device.backendId)?.tree !== undefined;
    }

    async tree(backendId: string, platform: DevicePlatform, deviceId: string): Promise<DeviceTree> {
        const backend = this.backend(backendId, platform);
        const read = backend.tree?.bind(backend);
        if (!read) {
            throw new DeviceError('device-tree-unavailable', 'Ruimte cannot read the accessibility tree of this device');
        }
        return this.guarded(() => read(deviceId));
    }

    closeTree(backendId: string, deviceId: string): void {
        this.backends.get(backendId)?.closeTree?.(deviceId);
    }

    closeAll(): void {
        for (const key of [...this.sessions.keys()]) {
            this.destroy(key);
        }
        for (const backend of this.backends.values()) {
            backend.closeAll?.();
        }
    }

    private async checkPath(path: string): Promise<void> {
        if (!isAbsolute(path)) {
            throw new DeviceError('device-path-refused', `${path} is not a path on this machine: name it from the root`);
        }
        try {
            await this.refusePath(path);
        } catch (error) {
            throw new DeviceError('device-path-refused', error instanceof Error ? error.message : `${path} is not handed to a device`);
        }
    }

    /* A paste goes through the source when it pastes itself, and otherwise sets the clipboard and presses the paste chord. */
    private async pasteInto(backend: DeviceBackend, deviceId: string, source: DeviceSource | null, text: string): Promise<void> {
        if (source?.paste) {
            await source.paste(text);
            return;
        }
        if (!backend.writeClipboard || !source?.keys) {
            throw new DeviceError('device-not-open', 'Open the device before pasting into it');
        }
        await backend.writeClipboard(deviceId, text);
        await source.keys([KEY_LEFT_COMMAND, KEY_V]);
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

    private async startFrameEvents(session: DeviceSession, clientId: string, binary: boolean): Promise<void> {
        const key = sessionKey(session.info.backendId, session.info.deviceId);
        const events = (frame: LiveStreamFrame): LiveEvent =>
            binary
                ? { event: 'device.frame', payload: frameHeader(session.info, frame), bytes: frame.data }
                : { event: 'device.frame', payload: { ...frameHeader(session.info, frame), data: Buffer.from(frame.data).toString('base64') } };
        await this.guarded(() => this.frames.start(key, session.streamId, clientId, events));
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

    /* Runs work of a backend or a source, its failure in the words and codes a client knows. */
    private async guarded<T>(work: () => Promise<T>): Promise<T> {
        try {
            return await work();
        } catch (error) {
            throw this.sourceError(error);
        }
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

function sessionKey(backendId: string, deviceId: string): string {
    return streamKeyOf(backendId, deviceId);
}

/* The clipboard of an open source, for a backend that has none of its own. */
function clipboardOf(source: DeviceSource | null): Required<Pick<DeviceSource, 'readClipboard' | 'writeClipboard'>> {
    if (source === null) {
        throw new DeviceError('device-not-open', 'Open the device before using its clipboard');
    }
    const { readClipboard, writeClipboard } = source;
    if (!readClipboard || !writeClipboard) {
        throw new DeviceError('device-action-unavailable', 'This device has no clipboard Ruimte reaches');
    }
    return { readClipboard: () => readClipboard.call(source), writeClipboard: (text) => writeClipboard.call(source, text) };
}

function requireFormat(source: DeviceSource, formats: readonly DeviceVideoFormat[]): void {
    if (!formats.includes(source.format ?? 'jpeg')) {
        throw new DeviceError('device-format-unsupported', 'Update Ruimte on this client to show this device');
    }
}

function frameHeader(device: DeviceInfo, frame: LiveStreamFrame): LiveFrameHeader<'device.frame'> {
    return {
        deviceId: device.deviceId,
        backendId: device.backendId,
        platform: device.platform,
        sequence: frame.sequence,
        width: frame.width,
        height: frame.height,
        ...(frame.format ? { format: frame.format } : {}),
        ...(frame.keyFrame !== undefined ? { keyFrame: frame.keyFrame } : {})
    };
}
