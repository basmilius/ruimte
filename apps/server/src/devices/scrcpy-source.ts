import type { DeviceInput, LiveStreamFrame } from '@ruimte/contracts';
import { DeviceError, type DeviceSource } from './manager.ts';
import { controlMessages, encodeResetVideo, SCRCPY_PROTOCOL_VERSION, ScrcpyVideoReader, type ScreenSize } from './scrcpy-protocol.ts';

export interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export interface ScrcpyServerProcess {
    readonly exited: Promise<number>;
    output(): string;
    kill(): void;
}

export interface ScrcpyConnection {
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

interface Session {
    serverProcess: ScrcpyServerProcess;
    port: number;
    video: ScrcpyConnection | null;
    control: ScrcpyConnection | null;
    screen: ScreenSize | null;
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
        const session: Session = { serverProcess, port, video: null, control: null, screen: null, ended: false };
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
                this.sequence = (this.sequence + 1) % 0x100000000;
                publish({ sequence: this.sequence, width: frame.width, height: frame.height, data: frame.data, format: 'h264', keyFrame: frame.keyFrame });
            }
        };
        try {
            session.video = await this.connectVideo(session, onVideo);
            session.control = await this.host.connect(port, { data: () => undefined, close: () => void this.end(session) });
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

    input(input: DeviceInput): void {
        const session = this.session;
        if (session === null || session.control === null) {
            throw new DeviceError('device-not-streaming', 'Open the device stream before sending input');
        }
        if (session.screen === null) {
            return;
        }
        for (const message of controlMessages(input, session.screen)) {
            session.control.write(message);
        }
    }

    requestKeyFrame(): void {
        this.session?.control?.write(encodeResetVideo());
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
export const adbScrcpyHost = (adb: string, serial: string): ScrcpyHost => ({
    adb: async (arguments_) => {
        const child = Bun.spawn([adb, '-s', serial, ...arguments_], { stdin: 'ignore', stdout: 'pipe', stderr: 'pipe' });
        const [exitCode, stdout, stderr] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
        return { exitCode, stdout, stderr };
    },
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
});
