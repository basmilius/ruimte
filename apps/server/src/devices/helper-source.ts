import { hevcKeyFrame, type DeviceInput, type LiveStreamFrame } from '@ruimte/contracts';
import type { LiveFrameSource } from '../streams/live-stream.ts';
import { DEVICE_HELPER_MAGIC, DeviceHelperDecoder, encodeDeviceHelperMessage } from './helper-protocol.ts';

export interface DeviceHelperProcess {
    readonly stdin: {
        write(chunk: Uint8Array): unknown;
        flush(): unknown;
        end(): unknown;
    };
    readonly protocol: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    readonly exited: Promise<number>;
    kill(signal: 'SIGTERM' | 'SIGKILL'): void;
}

export type DeviceHelperLauncher = (deviceId: string) => DeviceHelperProcess;

export class DeviceHelperFailure extends Error {
    readonly code: string;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'DeviceHelperFailure';
        this.code = code;
    }
}

export const createDeviceHelperLauncher =
    (command: string[]): DeviceHelperLauncher =>
    (deviceId) => {
        const child = Bun.spawn({
            cmd: [...command, deviceId],
            env: { ...process.env, RUIMTE_DEVICE_HELPER_PROTOCOL_FD: '3' },
            stdio: ['pipe', 'ignore', 'pipe', 'pipe']
        });
        const protocol = child.stdio[3];
        if (protocol === null) {
            child.kill('SIGTERM');
            throw new Error('The device helper protocol pipe could not be opened');
        }
        return {
            stdin: child.stdin,
            protocol: Bun.file(protocol).stream(),
            stderr: child.stderr,
            exited: child.exited,
            kill: (signal) => child.kill(signal)
        };
    };

export class DeviceHelperSource implements LiveFrameSource {
    readonly format: 'jpeg' | 'hevc';
    private readonly deviceId: string;
    private readonly launch: DeviceHelperLauncher;
    private readonly stopGraceMs: number;
    private process: DeviceHelperProcess | null = null;
    private outputTask: Promise<void> | null = null;
    private ready = false;
    private stderr = '';

    constructor(deviceId: string, launch: DeviceHelperLauncher, stopGraceMs = 500, format: 'jpeg' | 'hevc' = 'jpeg') {
        this.deviceId = deviceId;
        this.launch = launch;
        this.stopGraceMs = stopGraceMs;
        this.format = format;
    }

    async start(publish: (frame: LiveStreamFrame) => void): Promise<void> {
        if (this.process !== null) {
            throw new DeviceHelperFailure('device-helper-running', 'The device capture helper is already running');
        }

        let child: DeviceHelperProcess;
        try {
            child = this.launch(this.deviceId);
        } catch (error) {
            throw new DeviceHelperFailure('device-helper-unavailable', error instanceof Error ? error.message : 'The device capture helper could not start');
        }
        this.process = child;
        this.ready = false;
        this.stderr = '';
        try {
            child.stdin.write(DEVICE_HELPER_MAGIC);
            child.stdin.flush();
        } catch (error) {
            this.process = null;
            child.kill('SIGTERM');
            throw new DeviceHelperFailure('device-helper-unavailable', error instanceof Error ? error.message : 'The device capture helper could not start');
        }
        const stderrTask = this.readStderr(child);

        let resolveReady: () => void = () => undefined;
        let rejectReady: (error: unknown) => void = () => undefined;
        const ready = new Promise<void>((resolve, reject) => {
            resolveReady = resolve;
            rejectReady = reject;
        });
        let readySettled = false;
        const failReady = (error: unknown): void => {
            if (readySettled) {
                return;
            }
            readySettled = true;
            rejectReady(error);
        };
        this.outputTask = this.readProtocol(child, publish, () => {
            if (readySettled) {
                throw new DeviceHelperFailure('device-helper-protocol', 'The device capture helper became ready more than once');
            }
            this.ready = true;
            readySettled = true;
            resolveReady();
        }).catch((error: unknown) => {
            failReady(error);
            if (this.process === child) {
                this.process = null;
                this.ready = false;
                child.kill('SIGTERM');
            }
        });
        void child.exited.then(async (exitCode) => {
            await stderrTask;
            if (this.process !== child) {
                return;
            }
            this.process = null;
            this.ready = false;
            const detail = this.stderr.trim();
            failReady(
                new DeviceHelperFailure('device-helper-exited', detail || `The device capture helper exited${exitCode === 0 ? '' : ` with code ${exitCode}`}`)
            );
        });

        try {
            await ready;
        } catch (error) {
            if (this.process === child) {
                this.process = null;
                child.kill('SIGTERM');
            }
            throw error;
        }
    }

    input(input: DeviceInput): void {
        if (this.process === null || !this.ready) {
            throw new DeviceHelperFailure('device-not-streaming', 'Open the device stream before sending input');
        }
        this.process.stdin.write(encodeDeviceHelperMessage({ type: 'input', input }));
        this.process.stdin.flush();
    }

    keys(usages: readonly number[]): void {
        if (this.process === null || !this.ready) {
            throw new DeviceHelperFailure('device-not-streaming', 'Open the device stream before sending input');
        }
        this.process.stdin.write(encodeDeviceHelperMessage({ type: 'keys', usages: [...usages] }));
        this.process.stdin.flush();
    }

    async stop(): Promise<void> {
        const child = this.process;
        if (child === null) {
            return;
        }
        this.process = null;
        this.ready = false;
        try {
            child.stdin.write(encodeDeviceHelperMessage({ type: 'stop' }));
            child.stdin.flush();
            child.stdin.end();
        } catch {
            child.kill('SIGTERM');
        }
        const exited = await Promise.race([child.exited.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), this.stopGraceMs))]);
        if (!exited) {
            child.kill('SIGKILL');
        }
        if (exited) {
            await this.outputTask?.catch(() => undefined);
        }
        this.outputTask = null;
    }

    private async readProtocol(child: DeviceHelperProcess, publish: (frame: LiveStreamFrame) => void, becameReady: () => void): Promise<void> {
        const decoder = new DeviceHelperDecoder();
        for await (const chunk of child.protocol) {
            for (const message of decoder.push(chunk)) {
                if (message.type === 'ready') {
                    becameReady();
                } else if (message.type === 'frame') {
                    if (!this.ready) {
                        throw new DeviceHelperFailure('device-helper-protocol', 'The device capture helper sent a frame before it was ready');
                    }
                    publish(this.format === 'hevc' ? { ...message.frame, format: 'hevc', keyFrame: hevcKeyFrame(message.frame.data) } : message.frame);
                } else if (message.type === 'error') {
                    throw new DeviceHelperFailure(message.code, message.message);
                } else {
                    throw new DeviceHelperFailure('device-helper-protocol', 'The device capture helper sent a command on its output stream');
                }
            }
        }
    }

    private async readStderr(child: DeviceHelperProcess): Promise<void> {
        const text = await new Response(child.stderr).text().catch(() => '');
        if (this.process === child) {
            this.stderr = text.slice(-4096);
        }
    }
}
