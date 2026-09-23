import { describe, expect, test } from 'bun:test';
import type { LiveStreamFrame } from '@ruimte/contracts';
import { ScrcpySource, type ScrcpyHost } from './scrcpy-source.ts';

const header = (flags: number, size: number, width = 0, height = 0): number[] => {
    const bytes = new DataView(new ArrayBuffer(12));
    bytes.setUint8(0, flags);
    if (flags & 0x80) {
        bytes.setUint32(4, width);
        bytes.setUint32(8, height);
    } else {
        bytes.setUint32(8, size);
    }
    return [...new Uint8Array(bytes.buffer)];
};

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
        queueMicrotask(() => {
            if (attempt === 1) {
                handlers.close();
            } else if (attempt === 2) {
                handlers.data(opening);
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
        return Promise.resolve();
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

    test('ends the server and the forward when the last viewer leaves', async () => {
        const host = new FakeHost();
        const source = new ScrcpySource(host, () => Promise.resolve('/native/scrcpy-server'));
        await source.start(() => undefined);

        await source.stop();

        expect(host.killed).toBe(true);
        expect(host.adbCalls.at(-1)).toEqual(['forward', '--remove', 'tcp:27183']);
        expect(() => source.input({ kind: 'button', button: 'home' })).toThrow('Open the device stream before sending input');
    });
});
