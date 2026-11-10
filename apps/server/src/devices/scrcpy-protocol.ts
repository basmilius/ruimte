import type { DeviceInput } from '@ruimte/contracts';

/*
 * The wire of the Android screen server Ruimte pushes onto a device, written from its protocol
 * description (doc/develop.md at the pinned tag). The protocol is internal to that server and changes
 * between versions, so everything that knows its bytes lives here, next to the version it was written for.
 */
export const SCRCPY_PROTOCOL_VERSION = '4.1';

const CODEC_H264 = 0x68323634;
const SESSION_FLAG = 0x80;
const CONFIG_FLAG = 0x40;
const KEY_FRAME_FLAG = 0x20;
const HEADER_BYTES = 12;
const MAX_PACKET_BYTES = 8 * 1024 * 1024;

const TYPE_INJECT_KEYCODE = 0;
const TYPE_INJECT_TOUCH_EVENT = 2;
const TYPE_INJECT_SCROLL_EVENT = 3;
const TYPE_GET_CLIPBOARD = 8;
const TYPE_SET_CLIPBOARD = 9;
const TYPE_ROTATE_DEVICE = 11;
const TYPE_RESET_VIDEO = 17;

const DEVICE_CLIPBOARD = 0;
const DEVICE_ACK_CLIPBOARD = 1;
const DEVICE_UHID_OUTPUT = 2;

/* The server reads a control message of at most 256 KiB, of which a clipboard message spends 14 bytes before its text. */
const CLIPBOARD_TEXT_MAX_BYTES = (1 << 18) - 14;

const ACTION_DOWN = 0;
const ACTION_UP = 1;
const ACTION_MOVE = 2;

const KEYCODES = {
    home: 3,
    back: 4,
    lock: 26,
    appSwitcher: 187,
    siri: 219,
    volumeUp: 24,
    volumeDown: 25,
    power: 26,
    playPause: 85
} as const;

/* Android `KeyEvent` codes of the USB HID keyboard usages (page 7) a keyboard sends. */
const HID_KEYCODES: ReadonlyMap<number, number> = new Map([
    // a to z
    ...Array.from({ length: 26 }, (_, index): [number, number] => [0x04 + index, 29 + index]),
    // 1 to 9, then 0
    ...Array.from({ length: 9 }, (_, index): [number, number] => [0x1e + index, 8 + index]),
    [0x27, 7],
    [0x28, 66],
    [0x29, 111],
    [0x2a, 67],
    [0x2b, 61],
    [0x2c, 62],
    [0x2d, 69],
    [0x2e, 70],
    [0x2f, 71],
    [0x30, 72],
    [0x31, 73],
    [0x33, 74],
    [0x34, 75],
    [0x35, 68],
    [0x36, 55],
    [0x37, 56],
    [0x38, 76],
    [0x39, 115],
    // F1 to F12
    ...Array.from({ length: 12 }, (_, index): [number, number] => [0x3a + index, 131 + index]),
    [0x49, 124],
    [0x4a, 122],
    [0x4b, 92],
    [0x4c, 112],
    [0x4d, 123],
    [0x4e, 93],
    [0x4f, 22],
    [0x50, 21],
    [0x51, 20],
    [0x52, 19],
    [0xe0, 113],
    [0xe1, 59],
    [0xe2, 57],
    [0xe3, 117],
    [0xe4, 114],
    [0xe5, 60],
    [0xe6, 58],
    [0xe7, 118]
]);

/* Android `KeyEvent` meta state of each modifier usage while it is held: the side's own flag and the either-side one. */
const MODIFIER_META: ReadonlyMap<number, number> = new Map([
    [0xe0, 0x1000 | 0x2000],
    [0xe1, 0x1 | 0x40],
    [0xe2, 0x2 | 0x10],
    [0xe3, 0x10000 | 0x20000],
    [0xe4, 0x1000 | 0x4000],
    [0xe5, 0x1 | 0x80],
    [0xe6, 0x2 | 0x20],
    [0xe7, 0x10000 | 0x40000]
]);

/* Pixels of the scroll delta that make one wheel step on the device. */
const SCROLL_PIXELS_PER_STEP = 120;

export class ScrcpyProtocolError extends Error {
    readonly code = 'scrcpy-protocol';
}

interface ScrcpyVideoFrame {
    width: number;
    height: number;
    keyFrame: boolean;
    data: Uint8Array;
}

/*
 * Reads the video socket: an optional dummy byte, the codec id, then a session packet per capture
 * session and a media packet per encoded access unit. The codec configuration (SPS and PPS) arrives as
 * its own packet and is put in front of every key frame, so a viewer that starts on any key frame can decode it.
 */
export class ScrcpyVideoReader {
    private buffer: Uint8Array = new Uint8Array();
    private stage: 'dummy' | 'codec' | 'packets';
    private width = 0;
    private height = 0;
    private config: Uint8Array | null = null;

    constructor(options: { dummyByte: boolean }) {
        this.stage = options.dummyByte ? 'dummy' : 'codec';
    }

    push(chunk: Uint8Array): ScrcpyVideoFrame[] {
        this.buffer = this.buffer.byteLength === 0 ? chunk : concat(this.buffer, chunk);
        const frames: ScrcpyVideoFrame[] = [];
        let offset = 0;
        for (;;) {
            const available = this.buffer.byteLength - offset;
            if (this.stage === 'dummy') {
                if (available < 1) {
                    break;
                }
                offset += 1;
                this.stage = 'codec';
                continue;
            }
            if (this.stage === 'codec') {
                if (available < 4) {
                    break;
                }
                const codec = view(this.buffer, offset).getUint32(0);
                if (codec !== CODEC_H264) {
                    throw new ScrcpyProtocolError(`The device sent video in codec 0x${codec.toString(16)} instead of H.264`);
                }
                offset += 4;
                this.stage = 'packets';
                continue;
            }
            if (available < HEADER_BYTES) {
                break;
            }
            const header = view(this.buffer, offset);
            const flags = header.getUint8(0);
            if ((flags & SESSION_FLAG) !== 0) {
                this.width = header.getUint32(4);
                this.height = header.getUint32(8);
                this.config = null;
                offset += HEADER_BYTES;
                continue;
            }
            const size = header.getUint32(8);
            if (size > MAX_PACKET_BYTES) {
                throw new ScrcpyProtocolError('The device sent a video packet that is too large');
            }
            if (available < HEADER_BYTES + size) {
                break;
            }
            const payload = this.buffer.slice(offset + HEADER_BYTES, offset + HEADER_BYTES + size);
            offset += HEADER_BYTES + size;
            if ((flags & CONFIG_FLAG) !== 0) {
                this.config = payload;
                continue;
            }
            if (this.width === 0 || this.height === 0) {
                throw new ScrcpyProtocolError('The device sent video before its size');
            }
            const keyFrame = (flags & KEY_FRAME_FLAG) !== 0;
            frames.push({
                width: this.width,
                height: this.height,
                keyFrame,
                data: keyFrame && this.config !== null ? concat(this.config, payload) : payload
            });
        }
        // Nothing writes into a buffer once it is held, so what is left stays a view and is not copied.
        this.buffer = this.buffer.subarray(offset);
        return frames;
    }
}

/* The acknowledgement of a clipboard write, or the text of the device clipboard the server was asked for. */
type ScrcpyDeviceMessage = { kind: 'ack'; sequence: bigint } | { kind: 'clipboard'; text: string };

/* Reads what the server sends back on the control socket; a keyboard's output is read past. */
export class ScrcpyDeviceMessageReader {
    private buffer: Uint8Array = new Uint8Array();
    private readonly decoder = new TextDecoder();

    push(chunk: Uint8Array): ScrcpyDeviceMessage[] {
        this.buffer = this.buffer.byteLength === 0 ? chunk : concat(this.buffer, chunk);
        const messages: ScrcpyDeviceMessage[] = [];
        let offset = 0;
        for (;;) {
            const available = this.buffer.byteLength - offset;
            if (available < 1) {
                break;
            }
            const message = view(this.buffer, offset);
            const size = deviceMessageSize(message, available);
            if (size === null || available < size) {
                break;
            }
            const type = message.getUint8(0);
            if (type === DEVICE_ACK_CLIPBOARD) {
                messages.push({ kind: 'ack', sequence: message.getBigUint64(1) });
            } else if (type === DEVICE_CLIPBOARD) {
                messages.push({ kind: 'clipboard', text: this.decoder.decode(this.buffer.subarray(offset + 5, offset + size)) });
            }
            offset += size;
        }
        this.buffer = this.buffer.subarray(offset);
        return messages;
    }
}

/* The bytes of the device message `message` starts with, or null while its header has not all arrived. */
function deviceMessageSize(message: DataView, available: number): number | null {
    const type = message.getUint8(0);
    switch (type) {
        case DEVICE_ACK_CLIPBOARD:
            return 9;
        case DEVICE_CLIPBOARD:
            return available < 5 ? null : 5 + message.getUint32(1);
        case DEVICE_UHID_OUTPUT:
            return available < 5 ? null : 5 + message.getUint16(3);
        default:
            throw new ScrcpyProtocolError(`The device sent a message of unknown type ${type}`);
    }
}

export interface ScreenSize {
    width: number;
    height: number;
}

function encodeKeycode(action: typeof ACTION_DOWN | typeof ACTION_UP, keycode: number, metaState = 0): Uint8Array {
    const message = new DataView(new ArrayBuffer(14));
    message.setUint8(0, TYPE_INJECT_KEYCODE);
    message.setUint8(1, action);
    message.setInt32(2, keycode);
    message.setInt32(6, 0);
    message.setInt32(10, metaState);
    return new Uint8Array(message.buffer);
}

export function metaStateOf(held: Iterable<number>): number {
    let state = 0;
    for (const usage of held) {
        state |= MODIFIER_META.get(usage) ?? 0;
    }
    return state;
}

export function isModifierUsage(usage: number): boolean {
    return MODIFIER_META.has(usage);
}

export function encodeTouch(action: number, pointerId: number, x: number, y: number, screen: ScreenSize): Uint8Array {
    const message = new DataView(new ArrayBuffer(32));
    message.setUint8(0, TYPE_INJECT_TOUCH_EVENT);
    message.setUint8(1, action);
    message.setBigInt64(2, BigInt(pointerId));
    message.setInt32(10, toPixel(x, screen.width));
    message.setInt32(14, toPixel(y, screen.height));
    message.setUint16(18, screen.width);
    message.setUint16(20, screen.height);
    message.setUint16(22, action === ACTION_UP ? 0 : 0xffff);
    message.setInt32(24, 0);
    message.setInt32(28, 0);
    return new Uint8Array(message.buffer);
}

export function encodeScroll(x: number, y: number, horizontal: number, vertical: number, screen: ScreenSize): Uint8Array {
    const message = new DataView(new ArrayBuffer(21));
    message.setUint8(0, TYPE_INJECT_SCROLL_EVENT);
    message.setInt32(1, toPixel(x, screen.width));
    message.setInt32(5, toPixel(y, screen.height));
    message.setUint16(9, screen.width);
    message.setUint16(11, screen.height);
    message.setInt16(13, toScrollFixedPoint(horizontal));
    message.setInt16(15, toScrollFixedPoint(vertical));
    message.setInt32(17, 0);
    return new Uint8Array(message.buffer);
}

/* The key presses of a chord of USB HID usages, let go in reverse; null when the chord holds a key Ruimte does not know on Android. */
export function encodeKeyChord(usages: readonly number[]): Uint8Array[] | null {
    const keycodes = usages.map((usage) => HID_KEYCODES.get(usage));
    if (keycodes.some((keycode) => keycode === undefined)) {
        return null;
    }
    const pressed = keycodes as number[];
    return [...pressed.map((keycode) => encodeKeycode(ACTION_DOWN, keycode)), ...pressed.toReversed().map((keycode) => encodeKeycode(ACTION_UP, keycode))];
}

/* Sets the device clipboard and presses paste; a non-zero sequence asks the server to acknowledge it. */
export function encodeSetClipboard(sequence: bigint, text: string, paste: boolean): Uint8Array {
    const bytes = new TextEncoder().encode(text);
    if (bytes.byteLength > CLIPBOARD_TEXT_MAX_BYTES) {
        throw new ScrcpyProtocolError('The text is too long for the device clipboard');
    }
    const message = new Uint8Array(14 + bytes.byteLength);
    const header = new DataView(message.buffer);
    header.setUint8(0, TYPE_SET_CLIPBOARD);
    header.setBigUint64(1, sequence);
    header.setUint8(9, paste ? 1 : 0);
    header.setUint32(10, bytes.byteLength);
    message.set(bytes, 14);
    return message;
}

/* Asks the server for the device clipboard, without pressing copy first; it answers with a clipboard message, or nothing while the clipboard is empty. */
export function encodeGetClipboard(): Uint8Array {
    return new Uint8Array([TYPE_GET_CLIPBOARD, 0]);
}

function encodeRotate(): Uint8Array {
    return new Uint8Array([TYPE_ROTATE_DEVICE]);
}

/* Restarts the encoder, which answers with a fresh configuration and key frame. */
export function encodeResetVideo(): Uint8Array {
    return new Uint8Array([TYPE_RESET_VIDEO]);
}

/* The control messages one input becomes, against the size of the screen the last frame showed and the modifiers a person holds. */
export function controlMessages(input: DeviceInput, screen: ScreenSize, metaState = 0): Uint8Array[] {
    switch (input.kind) {
        case 'pointer':
            return [encodeTouch(touchAction(input.phase), 0, input.x, input.y, screen)];
        case 'multiPointer': {
            const action = touchAction(input.phase);
            return [encodeTouch(action, 0, input.first.x, input.first.y, screen), encodeTouch(action, 1, input.second.x, input.second.y, screen)];
        }
        case 'scroll':
            // A positive delta scrolls down on the web and up on Android.
            return [encodeScroll(input.x, input.y, -input.deltaX / SCROLL_PIXELS_PER_STEP, -input.deltaY / SCROLL_PIXELS_PER_STEP, screen)];
        case 'button': {
            if (input.button === 'swipeHome') {
                return controlMessages({ kind: 'button', button: 'home' }, screen);
            }
            const keycode = KEYCODES[input.button];
            return [encodeKeycode(ACTION_DOWN, keycode), encodeKeycode(ACTION_UP, keycode)];
        }
        case 'rotate':
            return [encodeRotate()];
        case 'key': {
            // A key Android has no code for is dropped, as a keyboard's unknown key would be.
            const keycode = HID_KEYCODES.get(input.usage);
            return keycode === undefined ? [] : [encodeKeycode(input.phase === 'down' ? ACTION_DOWN : ACTION_UP, keycode, metaState)];
        }
    }
}

function touchAction(phase: 'down' | 'move' | 'up'): number {
    return phase === 'down' ? ACTION_DOWN : phase === 'up' ? ACTION_UP : ACTION_MOVE;
}

function toPixel(fraction: number, extent: number): number {
    return Math.min(extent - 1, Math.max(0, Math.round(fraction * extent)));
}

/* A step count as the signed 16-bit fixed point of a value in [-16, 16] the server reads. */
function toScrollFixedPoint(steps: number): number {
    const fraction = Math.max(-1, Math.min(1, steps / 16));
    return Math.min(0x7fff, Math.round(fraction * 0x8000));
}

function view(bytes: Uint8Array, offset: number): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset + offset);
}

function concat(first: Uint8Array, second: Uint8Array): Uint8Array {
    const joined = new Uint8Array(first.byteLength + second.byteLength);
    joined.set(first);
    joined.set(second, first.byteLength);
    return joined;
}
