import { describe, expect, test } from 'bun:test';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { ScrcpySource, type ScrcpyHost } from './scrcpy-source.ts';

function header(flags: number, size: number, width = 0, height = 0): number[] {
    const bytes = new DataView(new ArrayBuffer(12));
    bytes.setUint8(0, flags);
    if (flags & 0x80) {
        bytes.setUint32(4, width);
        bytes.setUint32(8, height);
    } else {
        bytes.setUint32(8, size);
    }
    return [...new Uint8Array(bytes.buffer)];
}

const sps = [0, 0, 0, 1, 0x67, 0x42];
const idr = [0, 0, 0, 1, 0x65, 0x88];
const opening = new Uint8Array([
    0,
    0x68,
    0x32,
    0x36,
    0x34,
    ...header(0x80, 0, 1000, 2000),
    ...header(0x40, sps.length),
    ...sps,
    ...header(0x20, idr.length),
    ...idr
]);

class FakeHost implements ScrcpyHost {
    readonly adbCalls: string[][] = [];
    readonly spawned: string[][] = [];
    readonly control: Uint8Array[] = [];
    connections = 0;
    killed = false;
    /* Holds the video until `sendVideo`, as a device does that is slow with its first frame. */
    holdVideo = false;
    /* What `sleep` answers once the source started, so a test decides when a wait runs out. */
    wait: Promise<void> | null = null;
    private video: ((bytes: Uint8Array) => void) | null = null;
    private controlData: ((bytes: Uint8Array) => void) | null = null;
    private started = false;
    private exit: (code: number) => void = () => undefined;

    adb(arguments_: string[]) {
        this.adbCalls.push(arguments_);
        return Promise.resolve({ exitCode: 0, stdout: arguments_[0] === 'forward' && arguments_[1] === 'tcp:0' ? '27183\n' : '', stderr: '' });
    }

    spawn(arguments_: string[]) {
        this.spawned.push(arguments_);
        return {
            exited: new Promise<number>((resolve) => {
                this.exit = resolve;
            }),
            output: () => '',
            kill: () => {
                this.killed = true;
                this.exit(143);
            }
        };
    }

    connect(_port: number, handlers: { data(bytes: Uint8Array): void; close(): void }) {
        this.connections += 1;
        const attempt = this.connections;
        // The first connection lands before the server listens, the second is the video and the third the control socket.
        if (attempt === 3) {
            this.controlData = handlers.data;
        }
        queueMicrotask(() => {
            if (attempt === 1) {
                handlers.close();
            } else if (attempt === 2) {
                if (this.holdVideo) {
                    // The dummy byte and the codec, which is what tells the source the server listens.
                    handlers.data(opening.slice(0, 5));
                    this.video = handlers.data;
                } else {
                    handlers.data(opening);
                }
            }
        });
        return Promise.resolve({
            write: (bytes: Uint8Array) => {
                if (attempt === 3) {
                    this.control.push(bytes);
                }
            },
            close: () => undefined
        });
    }

    sleep() {
        return this.started && this.wait !== null ? this.wait : Promise.resolve();
    }

    sendVideo() {
        this.video?.(opening.slice(5));
    }

    acknowledge(sequence: bigint) {
        const message = new DataView(new ArrayBuffer(9));
        message.setUint8(0, 1);
        message.setBigUint64(1, sequence);
        this.controlData?.(new Uint8Array(message.buffer));
    }

    sendClipboard(text: string) {
        const bytes = new TextEncoder().encode(text);
        const message = new Uint8Array(5 + bytes.byteLength);
        new DataView(message.buffer).setUint32(1, bytes.byteLength);
        message.set(bytes, 5);
        this.controlData?.(message);
    }

    markStarted() {
        this.started = true;
    }
}

describe('ScrcpySource', () => {
    test('pushes the server, retries until it answers and publishes H.264 with its configuration', async () => {
        const host = new FakeHost();
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        const frames: LiveStreamFrame[] = [];

        await source.start((frame) => frames.push(frame));

        const [push, forward] = host.adbCalls;
        expect(push![0]).toBe('push');
        expect(push![2]).toMatch(/^\/data\/local\/tmp\/ruimte-scrcpy-[0-9a-f]{8}\.jar$/);
        expect(forward).toEqual(['forward', 'tcp:0', expect.stringMatching(/^localabstract:scrcpy_[0-9a-f]{8}$/)]);
        expect(host.spawned[0]).toContain('video_codec=h264');
        expect(host.connections).toBe(3);
        expect(frames).toEqual([{ sequence: 1, width: 1000, height: 2000, data: new Uint8Array([...sps, ...idr]), format: 'h264', keyFrame: true }]);
    });

    test('sends input in the pixels of the last frame and asks for a key frame', async () => {
        const host = new FakeHost();
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);

        source.input({ kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 });
        source.requestKeyFrame();

        const touch = new DataView(host.control[0]!.buffer);
        expect([touch.getInt32(10), touch.getInt32(14)]).toEqual([500, 500]);
        expect(host.control[1]).toEqual(new Uint8Array([17]));
    });

    test('holds a touch sent before the first frame until that frame gives it its pixels', async () => {
        const host = new FakeHost();
        host.holdVideo = true;
        host.wait = new Promise(() => undefined);
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);
        host.markStarted();

        const sent = source.input({ kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 });
        expect(host.control).toEqual([]);
        host.sendVideo();
        await sent;

        const touch = new DataView(host.control[0]!.buffer);
        expect([touch.getInt32(10), touch.getInt32(14)]).toEqual([500, 500]);
    });

    test('refuses a touch when no frame comes before the wait runs out', async () => {
        const host = new FakeHost();
        host.holdVideo = true;
        host.wait = Promise.resolve();
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);
        host.markStarted();

        await expect(source.input({ kind: 'pointer', phase: 'down', x: 0.5, y: 0.25 })).rejects.toThrow('The Android screen sent no picture yet');
        expect(host.control).toEqual([]);
    });

    test('ends the server and the forward when the last viewer leaves', async () => {
        const host = new FakeHost();
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);

        await source.stop();

        expect(host.killed).toBe(true);
        expect(host.adbCalls.at(-1)).toEqual(['forward', '--remove', 'tcp:27183']);
        expect(() => source.input({ kind: 'button', button: 'home' })).toThrow('Open the device stream before sending input');
    });

    test('pastes through the device clipboard and returns once the server acknowledged that write', async () => {
        const host = new FakeHost();
        host.wait = new Promise(() => undefined);
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);
        host.markStarted();

        let done = false;
        const pasted = source.paste('Grüße 🎉').then(() => {
            done = true;
        });
        await Promise.resolve();
        const message = new DataView(host.control[0]!.buffer);
        expect([message.getUint8(0), message.getBigUint64(1), message.getUint8(9)]).toEqual([9, 1n, 1]);
        expect(new TextDecoder().decode(host.control[0]!.slice(14))).toBe('Grüße 🎉');
        host.acknowledge(2n);
        await Promise.resolve();
        expect(done).toBe(false);

        host.acknowledge(1n);
        await pasted;
        expect(done).toBe(true);
    });

    test('reads the device clipboard by asking the server for it, and writes it without pasting', async () => {
        const host = new FakeHost();
        host.wait = new Promise(() => undefined);
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);
        host.markStarted();

        const read = source.readClipboard();
        await Promise.resolve();
        expect([...host.control[0]!]).toEqual([8, 0]);
        host.sendClipboard('copied on the phone ✓');
        expect(await read).toBe('copied on the phone ✓');

        const written = source.writeClipboard('mine');
        await Promise.resolve();
        const message = new DataView(host.control[1]!.buffer);
        expect([message.getUint8(0), message.getUint8(9)]).toEqual([9, 0]);
        host.acknowledge(message.getBigUint64(1));
        await written;
    });

    test('reads an empty clipboard as empty, since the server sends nothing for it', async () => {
        const host = new FakeHost();
        host.wait = Promise.resolve();
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);
        host.markStarted();

        expect(await source.readClipboard()).toBe('');
    });

    test('says so when the server never acknowledges a paste, or the stream ends while it waits', async () => {
        const host = new FakeHost();
        host.wait = Promise.resolve();
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);
        host.markStarted();
        await expect(source.paste('hi')).rejects.toMatchObject({ code: 'scrcpy-failed' });

        host.wait = new Promise(() => undefined);
        const waiting = source.paste('hi');
        await source.stop();
        await expect(waiting).rejects.toMatchObject({ code: 'device-not-streaming' });
        await expect(source.paste('hi')).rejects.toMatchObject({ code: 'device-not-streaming' });
    });

    test('presses Return and Tab, and refuses a key it does not know on Android', async () => {
        const host = new FakeHost();
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);

        source.keys([0x28]);
        source.keys([0x2b]);

        expect(host.control.map((message) => [message[0], message[1], new DataView(message.buffer).getInt32(2)])).toEqual([
            [0, 0, 66],
            [0, 1, 66],
            [0, 0, 61],
            [0, 1, 61]
        ]);
        expect(() => source.keys([0xe1, 0x64])).toThrow('Ruimte cannot press one of these keys on an Android device');
    });

    test("sends a person's keys with the modifiers they hold, before the first frame too", async () => {
        const host = new FakeHost();
        host.holdVideo = true;
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);

        await source.input({ kind: 'key', phase: 'down', usage: 0xe1 });
        await source.input({ kind: 'key', phase: 'down', usage: 0x04 });
        await source.input({ kind: 'key', phase: 'up', usage: 0xe1 });
        await source.input({ kind: 'key', phase: 'up', usage: 0x04 });

        expect(host.control.map((message) => [message[1], new DataView(message.buffer).getInt32(2), new DataView(message.buffer).getInt32(10)])).toEqual([
            [0, 59, 0x41],
            [0, 29, 0x41],
            [1, 59, 0],
            [1, 29, 0]
        ]);
    });
});
