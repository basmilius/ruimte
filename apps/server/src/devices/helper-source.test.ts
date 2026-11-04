import { describe, expect, test } from 'bun:test';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { concatBytes } from './device-test-helpers.ts';
import { DEVICE_HELPER_MAGIC, DeviceHelperDecoder, encodeDeviceHelperMessage, type DeviceHelperMessage } from './helper-protocol.ts';
import { DeviceHelperFailure, DeviceHelperSource, HELPER_CALL_TIMEOUT_MS, type DeviceHelperProcess } from './helper-source.ts';

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
        this.output.enqueue(concatBytes(DEVICE_HELPER_MAGIC, encodeDeviceHelperMessage(message)));
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

    closeOutput(): void {
        this.output.close();
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
        const commands = new DeviceHelperDecoder().push(concatBytes(...process.writes));
        expect(commands).toEqual([{ type: 'input', input: { kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 } }]);

        const stopping = source.stop();
        process.exit(0);
        await stopping;
        expect(new DeviceHelperDecoder().push(concatBytes(...process.writes))).toEqual([
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

    test('a helper that closes its output before ready fails the start even when it lives on', async () => {
        const process = new FakeHelperProcess();
        const source = new DeviceHelperSource('phone-1', () => process, 0);
        const started = source.start(() => undefined);
        process.closeOutput();

        await expect(started).rejects.toMatchObject({ code: 'device-helper-exited' });
        expect(process.signals).toEqual(['SIGTERM']);
    });

    test('a stop while the helper starts fails the start instead of leaving it open', async () => {
        const process = new FakeHelperProcess();
        const source = new DeviceHelperSource('phone-1', () => process, 0);
        const started = source.start(() => undefined);
        const stopping = source.stop();
        process.exit(0);
        await stopping;

        await expect(started).rejects.toMatchObject({ code: 'device-helper-stopped' });
    });

    test('a launch that throws is a start failure', async () => {
        const source = new DeviceHelperSource('phone-1', () => {
            throw new Error('no helper');
        });

        await expect(source.start(() => undefined)).rejects.toEqual(new DeviceHelperFailure('device-helper-unavailable', 'no helper'));
        await source.stop();
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

    test('sends a call to the helper and settles it with the reply of the same id', async () => {
        const process = new FakeHelperProcess();
        const source = new DeviceHelperSource('phone-1', () => process);
        const started = source.start(() => undefined);
        process.emit({ type: 'ready', width: 1179, height: 2556 });
        await started;

        const pose = source.call({ method: 'pose', name: 'book', fromDegrees: 180 });
        const warning = source.call({ method: 'memoryWarning' });
        const [first, second] = new DeviceHelperDecoder().push(concatBytes(...process.writes)) as Array<Extract<DeviceHelperMessage, { type: 'call' }>>;
        process.emitAfterPreamble({ type: 'reply', id: second!.id, ok: false, message: 'No warning today' });
        process.emitAfterPreamble({ type: 'reply', id: first!.id, ok: true, value: true });

        expect(await pose).toBe(true);
        await expect(warning).rejects.toEqual(new DeviceHelperFailure('device-helper-native', 'No warning today'));
        const waiting = source.call({ method: 'isFoldable' });
        const stopping = source.stop();
        process.exit(0);
        await stopping;
        await expect(waiting).rejects.toMatchObject({ code: 'device-not-streaming' });
    });

    test('gives up on a call the helper never answers, and forgets it', async () => {
        const process = new FakeHelperProcess();
        const timers: Array<{ ms: number; run: () => void }> = [];
        const source = new DeviceHelperSource(
            'phone-1',
            () => process,
            500,
            'jpeg',
            (ms, run) => {
                const entry = { ms, run };
                timers.push(entry);
                return () => timers.splice(timers.indexOf(entry), 1);
            }
        );
        const started = source.start(() => undefined);
        process.emit({ type: 'ready', width: 1179, height: 2556 });
        await started;

        const answered = source.call({ method: 'isFoldable' });
        const hanging = source.call({ method: 'memoryWarning' });
        const [first] = new DeviceHelperDecoder().push(concatBytes(...process.writes)) as Array<Extract<DeviceHelperMessage, { type: 'call' }>>;
        process.emitAfterPreamble({ type: 'reply', id: first!.id, ok: true, value: true });
        expect(await answered).toBe(true);
        expect(timers.map((entry) => entry.ms)).toEqual([HELPER_CALL_TIMEOUT_MS]);

        timers[0]!.run();
        await expect(hanging).rejects.toMatchObject({ code: 'device-helper-timeout' });
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
