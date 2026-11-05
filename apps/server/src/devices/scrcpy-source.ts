import type { DeviceInput, LiveStreamFrame } from '@ruimte/contracts';
import { runCommand, type CommandResult } from './command.ts';
import { DeviceError } from './device-error.ts';
import { type DeviceSource } from './manager.ts';
import {
    controlMessages,
    encodeGetClipboard,
    encodeKeyChord,
    encodeResetVideo,
    encodeSetClipboard,
    isModifierUsage,
    metaStateOf,
    SCRCPY_PROTOCOL_VERSION,
    ScrcpyDeviceMessageReader,
    ScrcpyVideoReader,
    type ScreenSize
} from './scrcpy-protocol.ts';

interface ScrcpyServerProcess {
    readonly exited: Promise<number>;
    output(): string;
    kill(): void;
}

interface ScrcpyConnection {
    write(bytes: Uint8Array): void;
    close(): void;
}

/* What the source asks of adb and of the loopback port adb forwards, so a test can stand in for both. */
export interface ScrcpyHost {
    adb(arguments_: string[]): Promise<CommandResult>;
    spawn(arguments_: string[]): ScrcpyServerProcess;
    connect(port: number, handlers: { data(bytes: Uint8Array): void; close(): void }): Promise<ScrcpyConnection>;
    sleep(ms: number): Promise<void>;
}

const CONNECT_ATTEMPTS = 50;
const CONNECT_RETRY_MS = 100;
const FIRST_BYTE_TIMEOUT_MS = 1_000;
/* How long input waits for the first frame, which is what gives a touch its pixels. */
const FIRST_FRAME_TIMEOUT_MS = 5_000;
/* How long a paste waits for the server to say it set the clipboard. */
const CLIPBOARD_ACK_TIMEOUT_MS = 5_000;
/* How long a read of the clipboard waits; the server sends nothing for an empty one. */
const CLIPBOARD_READ_TIMEOUT_MS = 3_000;

function writeInput(control: ScrcpyConnection, screen: ScreenSize, input: DeviceInput, metaState: number): void {
    for (const message of controlMessages(input, screen, metaState)) {
        control.write(message);
    }
}

interface Session {
    serverProcess: ScrcpyServerProcess;
    port: number;
    video: ScrcpyConnection | null;
    control: ScrcpyConnection | null;
    screen: ScreenSize | null;
    /* Settles with the first frame or the end of the session, whichever comes first. */
    firstFrame: Promise<void>;
    settleFirstFrame: () => void;
    /* The pastes waiting for their acknowledgement, by sequence; each settles true when it came and false when the session ended. */
    acks: Map<bigint, (acknowledged: boolean) => void>;
    /* The reads of the clipboard waiting for its text, in the order they asked; each settles null when the session ended. */
    clipboardReads: Array<(text: string | null) => void>;
    /* The modifier keys a person holds, which Android reads from every key event rather than from the modifier's own. */
    modifiers: Set<number>;
    ended: boolean;
}

/*
 * The screen and touch of an Android device, through the pinned screen server pushed onto it for as
 * long as someone watches. The server listens on an abstract socket that `adb forward` exposes on
 * loopback only; the video socket is opened first and the control socket second, as the server expects.
 */
export class ScrcpySource implements DeviceSource {
    readonly format = 'h264' as const;
    private readonly host: ScrcpyHost;
    private readonly serverPath: () => Promise<string>;
    private session: Session | null = null;
    private sequence = 0;
    private clipboardSequence = 0n;

    constructor(host: ScrcpyHost, serverPath: () => Promise<string>) {
        this.host = host;
        this.serverPath = serverPath;
    }

    async start(publish: (frame: LiveStreamFrame) => void): Promise<void> {
        if (this.session !== null) {
            throw new DeviceError('device-helper-running', 'The Android screen is already streaming');
        }
        const local = await this.serverPath();
        const scid = Math.floor(Math.random() * 0x7fffffff)
            .toString(16)
            .padStart(8, '0');
        // Every session pushes its own copy, since the server deletes the file it was started from.
        const remote = `/data/local/tmp/ruimte-scrcpy-${scid}.jar`;
        await this.adb(['push', local, remote]);
        const port = Number.parseInt((await this.adb(['forward', 'tcp:0', `localabstract:scrcpy_${scid}`])).stdout.trim(), 10);
        if (!Number.isInteger(port) || port <= 0) {
            throw new DeviceError('scrcpy-failed', 'adb did not name the port it forwarded');
        }
        const serverProcess = this.host.spawn([
            'shell',
            `CLASSPATH=${remote}`,
            'app_process',
            '/',
            'com.genymobile.scrcpy.Server',
            SCRCPY_PROTOCOL_VERSION,
            `scid=${scid}`,
            'log_level=warn',
            'tunnel_forward=true',
            'audio=false',
            'control=true',
            'cleanup=true',
            'video_codec=h264',
            'send_device_meta=false',
            'clipboard_autosync=false'
        ]);
        let settleFirstFrame = (): void => undefined;
        const firstFrame = new Promise<void>((resolve) => {
            settleFirstFrame = resolve;
        });
        const session: Session = {
            serverProcess,
            port,
            video: null,
            control: null,
            screen: null,
            firstFrame,
            settleFirstFrame,
            acks: new Map(),
            clipboardReads: [],
            modifiers: new Set(),
            ended: false
        };
        this.session = session;
        const reader = new ScrcpyVideoReader({ dummyByte: true });
        const onVideo = (bytes: Uint8Array): void => {
            let frames;
            try {
                frames = reader.push(bytes);
            } catch {
                void this.end(session);
                return;
            }
            for (const frame of frames) {
                session.screen = { width: frame.width, height: frame.height };
                session.settleFirstFrame();
                this.sequence = (this.sequence + 1) % 0x100000000;
                publish({ sequence: this.sequence, width: frame.width, height: frame.height, data: frame.data, format: 'h264', keyFrame: frame.keyFrame });
            }
        };
        try {
            session.video = await this.connectVideo(session, onVideo);
            const messages = new ScrcpyDeviceMessageReader();
            const onControl = (bytes: Uint8Array): void => {
                let received;
                try {
                    received = messages.push(bytes);
                } catch {
                    void this.end(session);
                    return;
                }
                for (const message of received) {
                    if (message.kind === 'ack') {
                        session.acks.get(message.sequence)?.(true);
                    } else {
                        session.clipboardReads.shift()?.(message.text);
                    }
                }
            };
            session.control = await this.host.connect(port, { data: onControl, close: () => void this.end(session) });
        } catch (error) {
            await this.end(session);
            throw error;
        }
        void serverProcess.exited.then(() => this.end(session));
    }

    async stop(): Promise<void> {
        if (this.session !== null) {
            await this.end(this.session);
        }
    }

    input(input: DeviceInput): void | Promise<void> {
        const session = this.controlled();
        if (input.kind === 'key') {
            this.key(session, input);
            return;
        }
        if (session.screen === null) {
            // A tap right after the stream opened, as an agent's first one is, waits for the pixels instead of vanishing.
            return this.inputAfterFirstFrame(session, input);
        }
        writeInput(session.control, session.screen, input, 0);
    }

    /* A key needs no picture, so it never waits for the first frame. */
    private key(session: Session & { control: ScrcpyConnection }, input: Extract<DeviceInput, { kind: 'key' }>): void {
        if (isModifierUsage(input.usage)) {
            if (input.phase === 'down') {
                session.modifiers.add(input.usage);
            } else {
                session.modifiers.delete(input.usage);
            }
        }
        writeInput(session.control, session.screen ?? { width: 1, height: 1 }, input, metaStateOf(session.modifiers));
    }

    private async inputAfterFirstFrame(session: Session, input: DeviceInput): Promise<void> {
        await Promise.race([session.firstFrame, this.host.sleep(FIRST_FRAME_TIMEOUT_MS)]);
        if (session.ended || session.control === null || session.screen === null) {
            throw new DeviceError('device-not-streaming', 'The Android screen sent no picture yet, so the touch had nowhere to land');
        }
        writeInput(session.control, session.screen, input, 0);
    }

    keys(usages: readonly number[]): void {
        const { control } = this.controlled();
        const messages = encodeKeyChord(usages);
        if (messages === null) {
            throw new DeviceError('device-input-unavailable', 'Ruimte cannot press one of these keys on an Android device');
        }
        for (const message of messages) {
            control.write(message);
        }
    }

    paste(text: string): Promise<void> {
        return this.setClipboard(text, true);
    }

    writeClipboard(text: string): Promise<void> {
        return this.setClipboard(text, false);
    }

    /* The text of the device clipboard; empty when the server sends none in time, which it does for an empty clipboard. */
    async readClipboard(): Promise<string> {
        const session = this.controlled();
        let settle: (text: string | null) => void = () => undefined;
        const read = new Promise<string | null>((resolve) => {
            settle = resolve;
        });
        session.clipboardReads.push(settle);
        session.control.write(encodeGetClipboard());
        const text = await Promise.race([read, this.host.sleep(CLIPBOARD_READ_TIMEOUT_MS).then(() => '')]);
        const waiting = session.clipboardReads.indexOf(settle);
        if (waiting >= 0) {
            session.clipboardReads.splice(waiting, 1);
        }
        if (text === null) {
            throw new DeviceError('device-not-streaming', 'The Android screen closed before the clipboard was read');
        }
        return text;
    }

    /* Waits for the server's acknowledgement, which it sends once the clipboard is set and, for a paste, the paste key is on its way. */
    private async setClipboard(text: string, paste: boolean): Promise<void> {
        const session = this.controlled();
        this.clipboardSequence += 1n;
        const sequence = this.clipboardSequence;
        const acknowledged = new Promise<boolean>((resolve) => {
            session.acks.set(sequence, resolve);
        });
        try {
            session.control.write(encodeSetClipboard(sequence, text, paste));
            if (!(await Promise.race([acknowledged, this.host.sleep(CLIPBOARD_ACK_TIMEOUT_MS).then(() => false)]))) {
                throw session.ended
                    ? new DeviceError('device-not-streaming', 'The Android screen closed before the text was pasted')
                    : new DeviceError('scrcpy-failed', 'The Android screen server did not confirm the text it was given');
            }
        } finally {
            session.acks.delete(sequence);
        }
    }

    requestKeyFrame(): void {
        this.session?.control?.write(encodeResetVideo());
    }

    private controlled(): Session & { control: ScrcpyConnection } {
        const session = this.session;
        if (session === null || session.control === null) {
            throw new DeviceError('device-not-streaming', 'Open the device stream before sending input');
        }
        return session as Session & { control: ScrcpyConnection };
    }

    /*
     * Connects until the server answers with its dummy byte. Until the server listens, adb accepts the
     * connection and closes it at once, so a connection without that byte is a retry and not the stream.
     */
    private async connectVideo(session: Session, onData: (bytes: Uint8Array) => void): Promise<ScrcpyConnection> {
        let exited = false;
        void session.serverProcess.exited.then(() => {
            exited = true;
        });
        for (let attempt = 0; attempt < CONNECT_ATTEMPTS && !exited && !session.ended; attempt += 1) {
            let settle: (answered: boolean) => void = () => undefined;
            const answered = new Promise<boolean>((resolve) => {
                settle = resolve;
            });
            let streaming = false;
            const connection = await this.host
                .connect(session.port, {
                    data: (bytes) => {
                        streaming = true;
                        settle(true);
                        onData(bytes);
                    },
                    close: () => {
                        settle(false);
                        if (streaming) {
                            void this.end(session);
                        }
                    }
                })
                .catch(() => null);
            if (connection !== null && (await Promise.race([answered, this.host.sleep(FIRST_BYTE_TIMEOUT_MS).then(() => false)]))) {
                return connection;
            }
            connection?.close();
            await this.host.sleep(CONNECT_RETRY_MS);
        }
        const detail = session.serverProcess.output().trim();
        throw new DeviceError('scrcpy-failed', detail || 'The Android screen server did not start');
    }

    private async end(session: Session): Promise<void> {
        if (session.ended) {
            return;
        }
        session.ended = true;
        session.settleFirstFrame();
        for (const settle of session.acks.values()) {
            settle(false);
        }
        for (const settle of session.clipboardReads.splice(0)) {
            settle(null);
        }
        if (this.session === session) {
            this.session = null;
        }
        session.video?.close();
        session.control?.close();
        session.serverProcess.kill();
        await this.host.adb(['forward', '--remove', `tcp:${session.port}`]).catch(() => undefined);
    }

    private async adb(arguments_: string[]): Promise<CommandResult> {
        let result: CommandResult;
        try {
            result = await this.host.adb(arguments_);
        } catch {
            throw new DeviceError('adb-unavailable', 'adb could not be started');
        }
        if (result.exitCode !== 0) {
            throw new DeviceError('scrcpy-failed', result.stderr.trim() || result.stdout.trim() || `adb ${arguments_[0]} failed`);
        }
        return result;
    }
}

/* The host of a real device: adb for one serial and a loopback socket. */
export function adbScrcpyHost(adb: string, serial: string): ScrcpyHost {
    return {
        adb: (arguments_) => runCommand([adb, '-s', serial, ...arguments_]),
        spawn: (arguments_) => {
            const child = Bun.spawn([adb, '-s', serial, ...arguments_], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
            let output = '';
            const collect = async (stream: ReadableStream<Uint8Array>): Promise<void> => {
                const decoder = new TextDecoder();
                for await (const chunk of stream) {
                    output = (output + decoder.decode(chunk, { stream: true })).slice(-4096);
                }
            };
            void collect(child.stdout).catch(() => undefined);
            void collect(child.stderr).catch(() => undefined);
            return { exited: child.exited, output: () => output, kill: () => child.kill('SIGTERM') };
        },
        connect: async (port, handlers) => {
            const queue: Uint8Array[] = [];
            const socket = await Bun.connect({
                hostname: '127.0.0.1',
                port,
                socket: {
                    data: (_socket, data) => handlers.data(new Uint8Array(data)),
                    close: () => handlers.close(),
                    error: () => handlers.close(),
                    drain: (current) => {
                        while (queue.length > 0) {
                            const next = queue[0]!;
                            const written = current.write(next);
                            if (written < next.byteLength) {
                                queue[0] = next.subarray(written);
                                return;
                            }
                            queue.shift();
                        }
                    }
                }
            });
            return {
                write: (bytes) => {
                    if (queue.length > 0) {
                        queue.push(bytes);
                        return;
                    }
                    const written = socket.write(bytes);
                    if (written < bytes.byteLength) {
                        queue.push(bytes.subarray(Math.max(0, written)));
                    }
                },
                close: () => socket.end()
            };
        },
        sleep: (ms) => Bun.sleep(ms)
    };
}
