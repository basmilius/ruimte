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
const TYPE_ROTATE_DEVICE = 11;
const TYPE_RESET_VIDEO = 17;

const ACTION_DOWN = 0;
const ACTION_UP = 1;
const ACTION_MOVE = 2;

/* Android `KeyEvent` codes. */
const KEYCODES = {
    home: 3,
    back: 4,
    lock: 26,
    appSwitcher: 187,
    siri: 219
} as const;

/* Pixels of the scroll delta that make one wheel step on the device. */
const SCROLL_PIXELS_PER_STEP = 120;

export class ScrcpyProtocolError extends Error {
    readonly code = 'scrcpy-protocol';
}

export interface ScrcpyVideoFrame {
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
        this.buffer = offset === 0 ? this.buffer : this.buffer.slice(offset);
        return frames;
    }
}

export interface ScreenSize {
    width: number;
    height: number;
}

export const encodeKeycode = (action: typeof ACTION_DOWN | typeof ACTION_UP, keycode: number): Uint8Array => {
    const message = new DataView(new ArrayBuffer(14));
    message.setUint8(0, TYPE_INJECT_KEYCODE);
    message.setUint8(1, action);
    message.setInt32(2, keycode);
    message.setInt32(6, 0);
    message.setInt32(10, 0);
    return new Uint8Array(message.buffer);
};

export const encodeTouch = (action: number, pointerId: number, x: number, y: number, screen: ScreenSize): Uint8Array => {
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
};

export const encodeScroll = (x: number, y: number, horizontal: number, vertical: number, screen: ScreenSize): Uint8Array => {
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
};

export const encodeRotate = (): Uint8Array => new Uint8Array([TYPE_ROTATE_DEVICE]);

/* Restarts the encoder, which answers with a fresh configuration and key frame. */
export const encodeResetVideo = (): Uint8Array => new Uint8Array([TYPE_RESET_VIDEO]);

/* The control messages one input becomes, against the size of the screen the last frame showed. */
export const controlMessages = (input: DeviceInput, screen: ScreenSize): Uint8Array[] => {
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
    }
};

const touchAction = (phase: 'down' | 'move' | 'up'): number => (phase === 'down' ? ACTION_DOWN : phase === 'up' ? ACTION_UP : ACTION_MOVE);

const toPixel = (fraction: number, extent: number): number => Math.min(extent - 1, Math.max(0, Math.round(fraction * extent)));

/* A step count as the signed 16-bit fixed point of a value in [-16, 16] the server reads. */
const toScrollFixedPoint = (steps: number): number => {
    const fraction = Math.max(-1, Math.min(1, steps / 16));
    return Math.min(0x7fff, Math.round(fraction * 0x8000));
};

const view = (bytes: Uint8Array, offset: number): DataView => new DataView(bytes.buffer, bytes.byteOffset + offset);

const concat = (first: Uint8Array, second: Uint8Array): Uint8Array => {
    const joined = new Uint8Array(first.byteLength + second.byteLength);
    joined.set(first);
    joined.set(second, first.byteLength);
    return joined;
};
