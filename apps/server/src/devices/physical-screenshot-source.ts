import { wait } from '@ruimte/agents/async';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import type { DeviceInput, LiveStreamFrame } from '@ruimte/contracts';
import { DeviceError, type DeviceSource } from './manager.ts';

interface CommandResult {
    exitCode: number;
    stdout: string;
    stderr: string;
}

export type PhysicalFrameCapture = (deviceId: string, sequence: number, directory: string, signal: AbortSignal) => Promise<LiveStreamFrame>;

const CaptureResultSchema = z.object({
    result: z.object({
        width: z.number().int().positive(),
        height: z.number().int().positive()
    })
});

const runCommand = async (command: string[], signal: AbortSignal): Promise<CommandResult> => {
    const process = Bun.spawn(command, { stdout: 'pipe', stderr: 'pipe' });
    const abort = (): void => process.kill('SIGTERM');
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
        abort();
    }
    try {
        const [exitCode, stdout, stderr] = await Promise.all([process.exited, new Response(process.stdout).text(), new Response(process.stderr).text()]);
        return { exitCode, stdout, stderr };
    } finally {
        signal.removeEventListener('abort', abort);
    }
};

/* A png of the screen written to `png`, and the size devicectl says it has. */
const capturePng = async (deviceId: string, png: string, signal: AbortSignal): Promise<{ width: number; height: number }> => {
    const captured = await runCommand(
        [
            '/usr/bin/xcrun',
            'devicectl',
            'device',
            'capture',
            'screenshot',
            '--device',
            deviceId,
            '--destination',
            png,
            '--json-output',
            '-',
            '--omit-deprecated-fields-in-json',
            '--quiet',
            '--timeout',
            '10'
        ],
        signal
    );
    if (captured.exitCode !== 0) {
        throw new DeviceError('device-capture-failed', captured.stderr.trim() || 'devicectl could not capture the device screen');
    }
    try {
        return CaptureResultSchema.parse(JSON.parse(captured.stdout)).result;
    } catch {
        throw new DeviceError('invalid-devicectl-output', 'devicectl returned screenshot details Ruimte could not read');
    }
};

export const capturePhysicalFrame: PhysicalFrameCapture = async (deviceId, sequence, directory, signal) => {
    const png = join(directory, 'screen.png');
    const jpeg = join(directory, 'screen.jpeg');
    const dimensions = await capturePng(deviceId, png, signal);
    await rm(jpeg, { force: true });
    const converted = await runCommand(['/usr/bin/sips', '-s', 'format', 'jpeg', '-s', 'formatOptions', '75', png, '--out', jpeg], signal);
    if (converted.exitCode !== 0) {
        throw new DeviceError('device-capture-failed', converted.stderr.trim() || 'The physical device screenshot could not be converted');
    }
    const data = new Uint8Array(await Bun.file(jpeg).arrayBuffer());
    return { sequence, width: dimensions.width, height: dimensions.height, data };
};

export type PhysicalScreenshot = (deviceId: string) => Promise<Uint8Array>;

/* One png of the screen at the phone's own resolution, for an agent, beside whatever preview runs. */
export const capturePhysicalScreenshot: PhysicalScreenshot = async (deviceId) => {
    const directory = await mkdtemp(join(tmpdir(), 'ruimte-ios-device-shot-'));
    try {
        const png = join(directory, 'screen.png');
        await capturePng(deviceId, png, new AbortController().signal);
        return new Uint8Array(await Bun.file(png).arrayBuffer());
    } finally {
        await rm(directory, { recursive: true, force: true });
    }
};

export class PhysicalScreenshotSource implements DeviceSource {
    private readonly capture: PhysicalFrameCapture;
    private readonly deviceId: string;
    private readonly pauseMs: number;
    private controller: AbortController | null = null;
    private directory: string | null = null;
    private sequence = 0;
    private task: Promise<void> | null = null;

    constructor(deviceId: string, capture: PhysicalFrameCapture = capturePhysicalFrame, pauseMs = 250) {
        this.deviceId = deviceId;
        this.capture = capture;
        this.pauseMs = pauseMs;
    }

    async start(publish: (frame: LiveStreamFrame) => void): Promise<void> {
        if (this.controller !== null) {
            throw new DeviceError('device-helper-running', 'The physical device preview is already running');
        }
        const controller = new AbortController();
        const directory = await mkdtemp(join(tmpdir(), 'ruimte-ios-device-'));
        this.controller = controller;
        this.directory = directory;
        try {
            publish(await this.next(directory, controller.signal));
        } catch (error) {
            this.controller = null;
            this.directory = null;
            await rm(directory, { recursive: true, force: true });
            throw error;
        }
        this.task = this.captureLoop(directory, controller.signal, publish);
    }

    async stop(): Promise<void> {
        const controller = this.controller;
        const directory = this.directory;
        if (controller === null) {
            return;
        }
        this.controller = null;
        this.directory = null;
        controller.abort();
        await this.task?.catch(() => undefined);
        this.task = null;
        if (directory) {
            await rm(directory, { recursive: true, force: true });
        }
    }

    input(_input: DeviceInput): never {
        throw new DeviceError('device-input-unavailable', 'Physical iOS devices are read-only');
    }

    private async captureLoop(directory: string, signal: AbortSignal, publish: (frame: LiveStreamFrame) => void): Promise<void> {
        while (!signal.aborted) {
            await wait(this.pauseMs, signal);
            if (signal.aborted) {
                return;
            }
            try {
                publish(await this.next(directory, signal));
            } catch {
                if (!signal.aborted) {
                    await wait(1_000, signal);
                }
            }
        }
    }

    private next(directory: string, signal: AbortSignal): Promise<LiveStreamFrame> {
        const sequence = this.sequence;
        this.sequence = (this.sequence + 1) >>> 0;
        return this.capture(this.deviceId, sequence, directory, signal);
    }
}
