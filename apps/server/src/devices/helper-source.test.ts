import { describe, expect, test } from 'bun:test';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { DEVICE_HELPER_MAGIC, DeviceHelperDecoder, encodeDeviceHelperMessage, type DeviceHelperMessage } from './helper-protocol.ts';
import { DeviceHelperFailure, DeviceHelperSource, type DeviceHelperProcess } from './helper-source.ts';

const join = (...chunks: Uint8Array[]): Uint8Array => {
    const result = new Uint8Array(chunks.reduce((size, chunk) => size + chunk.byteLength, 0));
    let offset = 0;
    for (const chunk of chunks) {
        result.set(chunk, offset);
        offset += chunk.byteLength;
    }
    return result;
};

class FakeHelperProcess implements DeviceHelperProcess {
    readonly writes: Uint8Array[] = [];
    readonly signals: string[] = [];
    readonly protocol: ReadableStream<Uint8Array>;
    readonly stderr: ReadableStream<Uint8Array>;
    readonly stdin = {
        write: (chunk: Uint8Array): void => {
            this.writes.push(chunk.slice());
        },
        flush: (): void => undefined,
        end: (): void => undefined
    };
    readonly exited: Promise<number>;
    private output!: ReadableStreamDefaultController<Uint8Array>;
    private errorOutput!: ReadableStreamDefaultController<Uint8Array>;
    private resolveExit!: (code: number) => void;

    constructor() {
        this.protocol = new ReadableStream({ start: (controller) => (this.output = controller) });
        this.stderr = new ReadableStream({ start: (controller) => (this.errorOutput = controller) });
        this.exited = new Promise((resolve) => (this.resolveExit = resolve));
    }

    emit(message: DeviceHelperMessage): void {
        this.output.enqueue(join(DEVICE_HELPER_MAGIC, encodeDeviceHelperMessage(message)));
    }

    emitAfterPreamble(message: Parameters<typeof encodeDeviceHelperMessage>[0]): void {
        this.output.enqueue(encodeDeviceHelperMessage(message));
    }

    exit(code: number, stderr = ''): void {
        if (stderr !== '') {
            this.errorOutput.enqueue(new TextEncoder().encode(stderr));
        }
        this.errorOutput.close();
        this.output.close();
        this.resolveExit(code);
    }

    kill(signal: 'SIGTERM' | 'SIGKILL'): void {
        this.signals.push(signal);
    }
}

describe('DeviceHelperSource', () => {
    test('waits for ready, publishes binary frames and sends input over the same protocol', async () => {
        const process = new FakeHelperProcess();
        const source = new DeviceHelperSource('phone-1', () => process);
        const frames: LiveStreamFrame[] = [];
        const started = source.start((frame) => frames.push(frame));
        process.emit({ type: 'ready', width: 1179, height: 2556 });
        await started;
        process.emitAfterPreamble({ type: 'frame', frame: { sequence: 1, width: 1179, height: 2556, data: new Uint8Array([1, 2, 3]) } });
        await Bun.sleep(0);
        source.input({ kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 });

        expect(frames).toEqual([{ sequence: 1, width: 1179, height: 2556, data: new Uint8Array([1, 2, 3]) }]);
        const commands = new DeviceHelperDecoder().push(join(...process.writes));
        expect(commands).toEqual([{ type: 'input', input: { kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 } }]);

        const stopping = source.stop();
        process.exit(0);
        await stopping;
        expect(new DeviceHelperDecoder().push(join(...process.writes))).toEqual([
            { type: 'input', input: { kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 } },
            { type: 'stop' }
        ]);
    });

    test('turns an early helper crash into a contained startup failure', async () => {
        const process = new FakeHelperProcess();
        const source = new DeviceHelperSource('phone-1', () => process);
        const started = source.start(() => undefined);
        process.exit(9, 'CoreSimulator could not be loaded');

        await expect(started).rejects.toEqual(new DeviceHelperFailure('device-helper-exited', 'CoreSimulator could not be loaded'));
    });

    test('marks frames from a native physical stream as HEVC, and says which ones a decoder can start from', async () => {
        const process = new FakeHelperProcess();
        const source = new DeviceHelperSource('phone-1', () => process, 500, 'hevc');
        const frames: LiveStreamFrame[] = [];
        const started = source.start((frame) => frames.push(frame));
        process.emit({ type: 'ready', width: 1, height: 1 });
        await started;
        const idr = new Uint8Array([0, 0, 0, 1, 19 << 1, 1]);
        const delta = new Uint8Array([0, 0, 0, 1, 1 << 1, 1]);
        process.emitAfterPreamble({ type: 'frame', frame: { sequence: 1, width: 1, height: 1, data: idr } });
        process.emitAfterPreamble({ type: 'frame', frame: { sequence: 2, width: 1, height: 1, data: delta } });
        await Bun.sleep(0);

        expect(frames).toEqual([
            { sequence: 1, width: 1, height: 1, format: 'hevc', keyFrame: true, data: idr },
            { sequence: 2, width: 1, height: 1, format: 'hevc', keyFrame: false, data: delta }
        ]);
        process.exit(0);
        await source.stop();
    });

    test('kills a helper that ignores stop', async () => {
        const process = new FakeHelperProcess();
        const source = new DeviceHelperSource('phone-1', () => process, 0);
        const started = source.start(() => undefined);
        process.emit({ type: 'ready', width: 1179, height: 2556 });
        await started;
        await source.stop();

        expect(process.signals).toEqual(['SIGKILL']);
    });
});
