import { createRequire } from 'node:module';
import type { DeviceInput } from '@ruimte/contracts';
import { DEVICE_HELPER_MAGIC, DeviceHelperDecoder, encodeDeviceHelperMessage, type DeviceHelperCall, type DeviceHelperMessage } from './helper-protocol.ts';
import { besideDaemon, serveSimFile } from './serve-sim.ts';

interface NativeHidHandle {
    touch(type: 'begin' | 'move' | 'end', x: number, y: number, width: number, height: number, edge: number): Promise<void>;
    multiTouch(type: 'begin' | 'move' | 'end', x1: number, y1: number, x2: number, y2: number, width: number, height: number): Promise<void>;
    scroll(deltaX: number, deltaY: number, anchorX: number, anchorY: number, width: number, height: number): Promise<void>;
    button(button: string): Promise<void>;
    orientation(orientation: number): Promise<boolean>;
    key(type: 'down' | 'up', usage: number): Promise<void>;
    /* A hardware button by its HID page and usage; `press` is a down and an up, the other two hold it. */
    buttonHid(page: number, usage: number, phase: 'press' | 'down' | 'up'): Promise<void>;
    memoryWarning(): Promise<void>;
    softwareKeyboard(): Promise<void>;
    /* Whether the simulator has a hinge, which only an iPhone Duo on Xcode 27.1 with the iOS 27.1 runtime has. */
    isFoldable(): Promise<boolean>;
    /* A named pose (closed, tent, tabletop, book, open) from the hinge angle it has now; false when the simulator refused it. */
    pose(name: string, fromDegrees: number): Promise<boolean>;
    hinge(degrees: number): Promise<boolean>;
    close(): Promise<void>;
}

interface NativeCaptureHandle {
    start(): Promise<void>;
    stop(): Promise<void>;
    /* Captures the display of this size, a panel of a foldable; 0 by 0 lets the simulator choose again. */
    setPreferredScreenSize(width: number, height: number): Promise<void>;
    subscribe(codec: number, onFrame: (data: Uint8Array, width: number, height: number, flags: number) => Promise<void>): Promise<() => void | Promise<void>>;
}

export interface DeviceNativeAddon {
    /* The second argument is the guest helper a foldable's hinge and buttons go through, which the addon starts inside the simulator. */
    SimHID: new (deviceId: string, duoHidPath: string) => NativeHidHandle;
    SimCapture: new (deviceId: string) => NativeCaptureHandle;
}

interface DeviceHelperRuntime {
    addon?: DeviceNativeAddon;
    duoHidPath?: string;
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

/* The consumer page (0x0C) of the HID usage tables, where a phone's side buttons sit. */
const CONSUMER_PAGE = 0x0c;
const CONSUMER_BUTTONS: Partial<Record<Extract<DeviceInput, { kind: 'button' }>['button'], number>> = {
    volumeUp: 0xe9,
    volumeDown: 0xea,
    playPause: 0xcd,
    power: 0x30
};

function loadDeviceNativeAddon(): DeviceNativeAddon {
    const path = serveSimFile('serve-sim-native.node', 'native');
    if (path === null) {
        throw new Error('serve-sim-native.node is not installed beside Ruimte or in its server dependencies');
    }
    return require(path) as DeviceNativeAddon;
}

/* The guest helper of an iPhone Duo. A path that does not exist only leaves the hinge unavailable, so it never fails the session. */
function resolveDuoHidHelper(): string {
    return serveSimFile('serve-sim-duo-hid', 'simduo') ?? besideDaemon('serve-sim-duo-hid');
}

export async function runDeviceHelper(deviceId: string, runtime?: DeviceHelperRuntime): Promise<number> {
    const input = runtime?.input ?? Bun.stdin.stream();
    const protocolDescriptor = Number(process.env.RUIMTE_DEVICE_HELPER_PROTOCOL_FD);
    const protocolSink =
        runtime?.write === undefined && Number.isInteger(protocolDescriptor) && protocolDescriptor >= 3 ? Bun.file(protocolDescriptor).writer() : null;
    const write =
        runtime?.write ??
        ((bytes: Uint8Array) => {
            if (protocolSink) {
                // A pipe the daemon closed rejects, and the helper ends on it as it should once the daemon went.
                void protocolSink.write(bytes);
                void protocolSink.flush();
            } else {
                process.stdout.write(bytes);
            }
        });
    write(DEVICE_HELPER_MAGIC);

    let capture: NativeCaptureHandle | null = null;
    let unsubscribe: (() => void | Promise<void>) | null = null;
    try {
        const addon = runtime?.addon ?? loadDeviceNativeAddon();
        const hid = new addon.SimHID(deviceId, runtime?.duoHidPath ?? resolveDuoHidHelper());
        const opened = new addon.SimCapture(deviceId);
        capture = opened;
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
            write(encodeDeviceHelperMessage({ type: 'frame', frame: { sequence, width, height, data } }));
            sequence = (sequence + 1) >>> 0;
        });
        await capture.start();

        const decoder = new DeviceHelperDecoder();
        for await (const chunk of input) {
            for (const message of decoder.push(chunk)) {
                if (message.type === 'stop') {
                    return 0;
                }
                if (message.type === 'keys') {
                    await pressKeys(hid, message.usages);
                    continue;
                }
                if (message.type === 'call') {
                    write(encodeDeviceHelperMessage(await answerCall(hid, opened, message.id, message.call)));
                    continue;
                }
                if (message.type !== 'input') {
                    throw new Error('The device helper received an output-only protocol message');
                }
                await applyDeviceInput(hid, message.input, width, height);
            }
        }
        return 0;
    } catch (error) {
        write(encodeDeviceHelperMessage({ type: 'error', code: 'device-helper-native', message: failureText(error) }));
        return 1;
    } finally {
        await unsubscribe?.();
        await capture?.stop();
        await protocolSink?.end();
    }
}

/* A call that fails is answered as failed, so the daemon's request says why and the stream goes on. */
async function answerCall(hid: NativeHidHandle, capture: NativeCaptureHandle, id: number, call: DeviceHelperCall): Promise<DeviceHelperMessage> {
    try {
        switch (call.method) {
            case 'memoryWarning':
                await hid.memoryWarning();
                return { type: 'reply', id, ok: true };
            case 'buttonHid':
                await hid.buttonHid(call.page, call.usage, call.phase);
                return { type: 'reply', id, ok: true };
            case 'isFoldable':
                return { type: 'reply', id, ok: true, value: await hid.isFoldable() };
            case 'pose':
                return { type: 'reply', id, ok: true, value: await hid.pose(call.name, call.fromDegrees) };
            case 'hinge':
                return { type: 'reply', id, ok: true, value: await hid.hinge(call.degrees) };
            case 'preferredScreenSize':
                await capture.setPreferredScreenSize(call.width, call.height);
                return { type: 'reply', id, ok: true };
        }
    } catch (error) {
        return { type: 'reply', id, ok: false, message: failureText(error) };
    }
}

/* Cut to what the protocol carries in a message. */
function failureText(error: unknown): string {
    return (error instanceof Error ? error.message : 'The native simulator helper failed').slice(0, 4096);
}

function touchPhase(phase: 'down' | 'move' | 'up'): 'begin' | 'move' | 'end' {
    return phase === 'down' ? 'begin' : phase === 'up' ? 'end' : 'move';
}

async function pressKeys(hid: NativeHidHandle, usages: readonly number[]): Promise<void> {
    for (const usage of usages) {
        await hid.key('down', usage);
    }
    for (const usage of [...usages].reverse()) {
        await hid.key('up', usage);
    }
}

async function applyDeviceInput(hid: NativeHidHandle, input: DeviceInput, width: number, height: number): Promise<void> {
    if (input.kind === 'pointer') {
        await hid.touch(touchPhase(input.phase), input.x, input.y, width, height, input.edge === 'bottom' ? NATIVE_EDGE_BOTTOM : 0);
    } else if (input.kind === 'multiPointer') {
        await hid.multiTouch(touchPhase(input.phase), input.first.x, input.first.y, input.second.x, input.second.y, width, height);
    } else if (input.kind === 'scroll') {
        void hid.scroll(input.deltaX, input.deltaY, input.x, input.y, width, height).catch(() => undefined);
    } else if (input.kind === 'button') {
        const button = NATIVE_BUTTONS[input.button];
        const consumer = CONSUMER_BUTTONS[input.button];
        if (button !== undefined) {
            await hid.button(button);
        } else if (consumer !== undefined) {
            await hid.buttonHid(CONSUMER_PAGE, consumer, 'press');
        }
    } else if (input.kind === 'key') {
        await hid.key(input.phase, input.usage);
    } else {
        await hid.orientation(input.direction === 'left' ? ORIENTATION_LANDSCAPE_LEFT : ORIENTATION_LANDSCAPE_RIGHT);
    }
}
