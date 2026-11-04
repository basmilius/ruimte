import { cancellableTimeout, type Timer } from '@adecore/utils/async';
import { hevcKeyFrame, type DeviceInput, type LiveStreamFrame } from '@ruimte/contracts';
import type { LiveFrameSource } from '../streams/live-stream.ts';
import { DEVICE_HELPER_MAGIC, DeviceHelperDecoder, encodeDeviceHelperMessage, type DeviceHelperCall, type DeviceHelperMessage } from './helper-protocol.ts';

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

export function createDeviceHelperLauncher(command: string[]): DeviceHelperLauncher {
    return (deviceId) => {
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
}

/* Every call answers within moments; a helper that takes this long will not answer at all. */
export const HELPER_CALL_TIMEOUT_MS = 30_000;

export class DeviceHelperSource implements LiveFrameSource {
    readonly format: 'jpeg' | 'hevc';
    private readonly deviceId: string;
    private readonly launch: DeviceHelperLauncher;
    private readonly stopGraceMs: number;
    private readonly timer: Timer;
    private process: DeviceHelperProcess | null = null;
    private outputTask: Promise<void> | null = null;
    private abandonStart: ((error: unknown) => void) | null = null;
    private ready = false;
    private stderr = '';
    private nextCall = 0;
    /* The calls waiting for their reply, by id; the helper answers each in the order it was sent. */
    private readonly calls = new Map<number, { resolve: (value: boolean | undefined) => void; reject: (error: unknown) => void; cancel: () => void }>();

    constructor(deviceId: string, launch: DeviceHelperLauncher, stopGraceMs = 500, format: 'jpeg' | 'hevc' = 'jpeg', timer: Timer = cancellableTimeout) {
        this.deviceId = deviceId;
        this.launch = launch;
        this.stopGraceMs = stopGraceMs;
        this.format = format;
        this.timer = timer;
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
        const exitHandled = child.exited.then(async (exitCode) => {
            await stderrTask;
            if (this.process !== child) {
                return;
            }
            this.process = null;
            this.ready = false;
            this.failCalls(new DeviceHelperFailure('device-helper-exited', 'The device capture helper exited before the tool answered'));
            const detail = this.stderr.trim();
            failReady(
                new DeviceHelperFailure('device-helper-exited', detail || `The device capture helper exited${exitCode === 0 ? '' : ` with code ${exitCode}`}`)
            );
        });
        this.outputTask = this.readProtocol(child, publish, () => {
            if (readySettled) {
                throw new DeviceHelperFailure('device-helper-protocol', 'The device capture helper became ready more than once');
            }
            this.ready = true;
            readySettled = true;
            resolveReady();
        }).then(
            async () => {
                // The exit that usually follows says why, with stderr; a helper that lives on without output gets the stop grace.
                await settledWithin(exitHandled, this.stopGraceMs);
                failReady(new DeviceHelperFailure('device-helper-exited', 'The device capture helper closed its output before it was ready'));
            },
            (error: unknown) => {
                failReady(error);
                if (this.process === child) {
                    this.process = null;
                    this.ready = false;
                    child.kill('SIGTERM');
                }
            }
        );

        this.abandonStart = failReady;
        try {
            await ready;
        } catch (error) {
            if (this.process === child) {
                this.process = null;
                child.kill('SIGTERM');
            }
            throw error;
        } finally {
            if (this.abandonStart === failReady) {
                this.abandonStart = null;
            }
        }
    }

    input(input: DeviceInput): void {
        this.send({ type: 'input', input }, 'Open the device stream before sending input');
    }

    keys(usages: readonly number[]): void {
        this.send({ type: 'keys', usages: [...usages] }, 'Open the device stream before sending input');
    }

    /* Asks the running helper to do something beside input; answers what a yes-or-no call said. */
    call(call: DeviceHelperCall): Promise<boolean | undefined> {
        if (this.process === null || !this.ready) {
            return Promise.reject(new DeviceHelperFailure('device-not-streaming', 'Open the device stream before using this tool'));
        }
        this.nextCall = (this.nextCall + 1) >>> 0;
        const id = this.nextCall;
        const answered = new Promise<boolean | undefined>((resolve, reject) => {
            const cancel = this.timer(HELPER_CALL_TIMEOUT_MS, () => {
                this.calls.delete(id);
                reject(new DeviceHelperFailure('device-helper-timeout', 'The device helper did not answer the tool in time'));
            });
            this.calls.set(id, { resolve, reject, cancel });
        });
        this.send({ type: 'call', id, call }, 'Open the device stream before using this tool');
        return answered;
    }

    private send(message: DeviceHelperMessage, notStreaming: string): void {
        if (this.process === null || !this.ready) {
            throw new DeviceHelperFailure('device-not-streaming', notStreaming);
        }
        this.process.stdin.write(encodeDeviceHelperMessage(message));
        this.process.stdin.flush();
    }

    async stop(): Promise<void> {
        const child = this.process;
        if (child === null) {
            return;
        }
        this.process = null;
        this.ready = false;
        this.failCalls(new DeviceHelperFailure('device-not-streaming', 'The device stream closed before the tool answered'));
        this.abandonStart?.(new DeviceHelperFailure('device-helper-stopped', 'The device capture helper was stopped before it was ready'));
        try {
            child.stdin.write(encodeDeviceHelperMessage({ type: 'stop' }));
            child.stdin.flush();
            child.stdin.end();
        } catch {
            child.kill('SIGTERM');
        }
        const exited = await Promise.race([child.exited.then(() => true), new Promise<false>((resolve) => setTimeout(() => resolve(false), this.stopGraceMs))]);
        if (exited) {
            await this.outputTask?.catch(() => undefined);
        } else {
            child.kill('SIGKILL');
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
                } else if (message.type === 'reply') {
                    const waiting = this.calls.get(message.id);
                    this.calls.delete(message.id);
                    waiting?.cancel();
                    if (message.ok) {
                        waiting?.resolve(message.value);
                    } else {
                        waiting?.reject(new DeviceHelperFailure('device-helper-native', message.message ?? 'The native simulator helper failed'));
                    }
                } else if (message.type === 'error') {
                    throw new DeviceHelperFailure(message.code, message.message);
                } else {
                    throw new DeviceHelperFailure('device-helper-protocol', 'The device capture helper sent a command on its output stream');
                }
            }
        }
    }

    private failCalls(error: DeviceHelperFailure): void {
        for (const waiting of this.calls.values()) {
            waiting.cancel();
            waiting.reject(error);
        }
        this.calls.clear();
    }

    private async readStderr(child: DeviceHelperProcess): Promise<void> {
        const text = await new Response(child.stderr).text().catch(() => '');
        if (this.process === child) {
            this.stderr = text.slice(-4096);
        }
    }
}

function settledWithin(task: Promise<unknown>, ms: number): Promise<void> {
    return new Promise((resolve) => {
        const timer = setTimeout(resolve, ms);
        void task.finally(() => {
            clearTimeout(timer);
            resolve();
        });
    });
}
