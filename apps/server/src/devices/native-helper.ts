import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import type { DeviceInput } from '@ruimte/contracts';
import { DEVICE_HELPER_MAGIC, DeviceHelperDecoder, encodeDeviceHelperMessage } from './helper-protocol.ts';

interface NativeHidHandle {
    touch(type: 'begin' | 'move' | 'end', x: number, y: number, width: number, height: number, edge: number): Promise<void>;
    multiTouch(type: 'begin' | 'move' | 'end', x1: number, y1: number, x2: number, y2: number, width: number, height: number): Promise<void>;
    scroll(deltaX: number, deltaY: number, anchorX: number, anchorY: number, width: number, height: number): Promise<void>;
    button(button: string): Promise<void>;
    orientation(orientation: number): Promise<boolean>;
}

interface NativeCaptureHandle {
    start(): Promise<void>;
    stop(): Promise<void>;
    subscribe(codec: number, onFrame: (data: Uint8Array, width: number, height: number, flags: number) => Promise<void>): Promise<() => void | Promise<void>>;
}

export interface DeviceNativeAddon {
    SimHID: new (deviceId: string) => NativeHidHandle;
    SimCapture: new (deviceId: string) => NativeCaptureHandle;
}

interface DeviceHelperRuntime {
    addon?: DeviceNativeAddon;
    input?: ReadableStream<Uint8Array>;
    write?(bytes: Uint8Array): void;
}

const require = createRequire(import.meta.url);
const CODEC_MJPEG = 0;
const NATIVE_EDGE_BOTTOM = 3;
const ORIENTATION_LANDSCAPE_RIGHT = 3;
const ORIENTATION_LANDSCAPE_LEFT = 4;
/* An iPhone has no Back button, and a simulator does not announce one. */
const NATIVE_BUTTONS: Partial<Record<Extract<DeviceInput, { kind: 'button' }>['button'], string>> = {
    home: 'home',
    swipeHome: 'swipe_home',
    appSwitcher: 'app_switcher',
    lock: 'lock',
    siri: 'siri'
};

export const resolveDeviceNativeAddon = (): string => {
    const besideExecutable = join(dirname(process.execPath), 'native', 'serve-sim-native.node');
    if (existsSync(besideExecutable)) {
        return besideExecutable;
    }
    try {
        const middleware = Bun.resolveSync('serve-sim/middleware', import.meta.dir);
        const dependency = join(dirname(middleware), 'native', 'serve-sim-native.node');
        if (existsSync(dependency)) {
            return dependency;
        }
    } catch {
        // The stable error below names the missing runtime component without leaking resolver details.
    }
    throw new Error('serve-sim-native.node is not installed beside Ruimte or in its server dependencies');
};

export const loadDeviceNativeAddon = (): DeviceNativeAddon => require(resolveDeviceNativeAddon()) as DeviceNativeAddon;

export const runDeviceHelper = async (deviceId: string, runtime?: DeviceHelperRuntime): Promise<number> => {
    const input = runtime?.input ?? Bun.stdin.stream();
    const protocolDescriptor = Number(process.env.RUIMTE_DEVICE_HELPER_PROTOCOL_FD);
    const protocolSink =
        runtime?.write === undefined && Number.isInteger(protocolDescriptor) && protocolDescriptor >= 3 ? Bun.file(protocolDescriptor).writer() : null;
    const write =
        runtime?.write ??
        ((bytes: Uint8Array) => {
            if (protocolSink) {
                protocolSink.write(bytes);
                protocolSink.flush();
            } else {
                process.stdout.write(bytes);
            }
        });
    write(DEVICE_HELPER_MAGIC);

    let capture: NativeCaptureHandle | null = null;
    let unsubscribe: (() => void | Promise<void>) | null = null;
    try {
        const addon = runtime?.addon ?? loadDeviceNativeAddon();
        const hid = new addon.SimHID(deviceId);
        capture = new addon.SimCapture(deviceId);
        let width = 0;
        let height = 0;
        let sequence = 0;
        let ready = false;

        unsubscribe = await capture.subscribe(CODEC_MJPEG, async (data, frameWidth, frameHeight) => {
            width = frameWidth;
            height = frameHeight;
            if (!ready) {
                ready = true;
                write(encodeDeviceHelperMessage({ type: 'ready', width, height }));
            }
            write(
                encodeDeviceHelperMessage({
                    type: 'frame',
                    frame: { sequence, width, height, data }
                })
            );
            sequence = (sequence + 1) >>> 0;
        });
        await capture.start();

        const decoder = new DeviceHelperDecoder();
        for await (const chunk of input) {
            for (const message of decoder.push(chunk)) {
                if (message.type === 'stop') {
                    return 0;
                }
                if (message.type !== 'input') {
                    throw new Error('The device helper received an output-only protocol message');
                }
                await applyDeviceInput(hid, message.input, width, height);
            }
        }
        return 0;
    } catch (error) {
        const message = error instanceof Error ? error.message : 'The native simulator helper failed';
        write(encodeDeviceHelperMessage({ type: 'error', code: 'device-helper-native', message: message.slice(0, 4096) }));
        return 1;
    } finally {
        await unsubscribe?.();
        await capture?.stop();
        protocolSink?.end();
    }
};

const applyDeviceInput = async (hid: NativeHidHandle, input: DeviceInput, width: number, height: number): Promise<void> => {
    if (input.kind === 'pointer') {
        const phase = input.phase === 'down' ? 'begin' : input.phase === 'up' ? 'end' : 'move';
        await hid.touch(phase, input.x, input.y, width, height, input.edge === 'bottom' ? NATIVE_EDGE_BOTTOM : 0);
    } else if (input.kind === 'multiPointer') {
        const phase = input.phase === 'down' ? 'begin' : input.phase === 'up' ? 'end' : 'move';
        await hid.multiTouch(phase, input.first.x, input.first.y, input.second.x, input.second.y, width, height);
    } else if (input.kind === 'scroll') {
        void hid.scroll(input.deltaX, input.deltaY, input.x, input.y, width, height).catch(() => undefined);
    } else if (input.kind === 'button') {
        const button = NATIVE_BUTTONS[input.button];
        if (button !== undefined) {
            await hid.button(button);
        }
    } else {
        await hid.orientation(input.direction === 'left' ? ORIENTATION_LANDSCAPE_LEFT : ORIENTATION_LANDSCAPE_RIGHT);
    }
};
