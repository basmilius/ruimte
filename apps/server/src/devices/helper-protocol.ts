import { DeviceInputSchema, encodeLiveStreamFrame, LIVE_STREAM_FRAME_HEADER_BYTES, LIVE_STREAM_MAX_FRAME_BYTES } from '@ruimte/contracts';
import type { DeviceInput, LiveStreamFrame } from '@ruimte/contracts';
import { z } from 'zod';

export const DEVICE_HELPER_MAGIC = new Uint8Array([0x52, 0x44, 0x45, 0x56, 0x01, 0x00, 0x00, 0x00]);
export const DEVICE_HELPER_HEADER_BYTES = 5;
export const DEVICE_HELPER_MAX_CONTROL_BYTES = 64 * 1024;

const ReadySchema = z.object({ width: z.number().int().min(1).max(0xffff), height: z.number().int().min(1).max(0xffff) });
const ErrorSchema = z.object({ code: z.string().min(1).max(128), message: z.string().min(1).max(4096) });
/* A chord of USB HID keyboard usages (page 7), pressed in order and let go in reverse. */
const KeysSchema = z.object({ usages: z.array(z.number().int().min(0).max(0xffff)).min(1).max(8) });

export type DeviceHelperMessage =
    | { type: 'ready'; width: number; height: number }
    | { type: 'frame'; frame: LiveStreamFrame }
    | { type: 'error'; code: string; message: string }
    | { type: 'input'; input: DeviceInput }
    | { type: 'keys'; usages: number[] }
    | { type: 'stop' };

const MessageKind = {
    ready: 1,
    frame: 2,
    error: 3,
    input: 17,
    stop: 18,
    keys: 19
} as const;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export const encodeDeviceHelperMessage = (message: DeviceHelperMessage): Uint8Array => {
    const kind = MessageKind[message.type];
    let payload: Uint8Array;
    if (message.type === 'ready') {
        const ready = ReadySchema.parse(message);
        payload = textEncoder.encode(JSON.stringify({ width: ready.width, height: ready.height }));
    } else if (message.type === 'frame') {
        payload = encodeLiveStreamFrame(message.frame);
    } else if (message.type === 'error') {
        const error = ErrorSchema.parse(message);
        payload = textEncoder.encode(JSON.stringify({ code: error.code, message: error.message }));
    } else if (message.type === 'input') {
        payload = textEncoder.encode(JSON.stringify(DeviceInputSchema.parse(message.input)));
    } else if (message.type === 'keys') {
        payload = textEncoder.encode(JSON.stringify(KeysSchema.parse({ usages: message.usages })));
    } else {
        payload = new Uint8Array();
    }
    if (message.type !== 'frame' && payload.byteLength > DEVICE_HELPER_MAX_CONTROL_BYTES) {
        throw new Error('Device helper control message is too large');
    }
    const encoded = new Uint8Array(DEVICE_HELPER_HEADER_BYTES + payload.byteLength);
    const header = new DataView(encoded.buffer);
    header.setUint8(0, kind);
    header.setUint32(1, payload.byteLength);
    encoded.set(payload, DEVICE_HELPER_HEADER_BYTES);
    return encoded;
};

export class DeviceHelperDecoder {
    private buffer = new Uint8Array();
    private preambleRead = false;

    push(chunk: Uint8Array): DeviceHelperMessage[] {
        const joined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
        joined.set(this.buffer);
        joined.set(chunk, this.buffer.byteLength);
        this.buffer = joined;

        if (!this.preambleRead) {
            if (this.buffer.byteLength < DEVICE_HELPER_MAGIC.byteLength) {
                return [];
            }
            for (let index = 0; index < DEVICE_HELPER_MAGIC.byteLength; index += 1) {
                if (this.buffer[index] !== DEVICE_HELPER_MAGIC[index]) {
                    throw new Error('Unknown device helper protocol');
                }
            }
            this.buffer = this.buffer.slice(DEVICE_HELPER_MAGIC.byteLength);
            this.preambleRead = true;
        }

        const messages: DeviceHelperMessage[] = [];
        while (this.buffer.byteLength >= DEVICE_HELPER_HEADER_BYTES) {
            const header = new DataView(this.buffer.buffer, this.buffer.byteOffset, DEVICE_HELPER_HEADER_BYTES);
            const kind = header.getUint8(0);
            const length = header.getUint32(1);
            const maximum = kind === MessageKind.frame ? LIVE_STREAM_FRAME_HEADER_BYTES + LIVE_STREAM_MAX_FRAME_BYTES : DEVICE_HELPER_MAX_CONTROL_BYTES;
            if (length > maximum) {
                throw new Error('Device helper message is too large');
            }
            const total = DEVICE_HELPER_HEADER_BYTES + length;
            if (this.buffer.byteLength < total) {
                break;
            }
            const payload = this.buffer.slice(DEVICE_HELPER_HEADER_BYTES, total);
            messages.push(this.decode(kind, payload));
            this.buffer = this.buffer.slice(total);
        }
        return messages;
    }

    private decode(kind: number, payload: Uint8Array): DeviceHelperMessage {
        if (kind === MessageKind.ready) {
            return { type: 'ready', ...ReadySchema.parse(this.json(payload)) };
        }
        if (kind === MessageKind.frame) {
            return { type: 'frame', frame: decodeFrame(payload) };
        }
        if (kind === MessageKind.error) {
            return { type: 'error', ...ErrorSchema.parse(this.json(payload)) };
        }
        if (kind === MessageKind.input) {
            return { type: 'input', input: DeviceInputSchema.parse(this.json(payload)) };
        }
        if (kind === MessageKind.keys) {
            return { type: 'keys', ...KeysSchema.parse(this.json(payload)) };
        }
        if (kind === MessageKind.stop && payload.byteLength === 0) {
            return { type: 'stop' };
        }
        throw new Error('Unknown device helper message');
    }

    private json(payload: Uint8Array): unknown {
        try {
            return JSON.parse(textDecoder.decode(payload));
        } catch {
            throw new Error('Invalid device helper control message');
        }
    }
}

const decodeFrame = (payload: Uint8Array): LiveStreamFrame => {
    if (payload.byteLength < LIVE_STREAM_FRAME_HEADER_BYTES) {
        throw new Error('Invalid device helper frame');
    }
    const header = new DataView(payload.buffer, payload.byteOffset, LIVE_STREAM_FRAME_HEADER_BYTES);
    const length = header.getUint32(0);
    const width = header.getUint16(8);
    const height = header.getUint16(10);
    if (length > LIVE_STREAM_MAX_FRAME_BYTES || payload.byteLength !== LIVE_STREAM_FRAME_HEADER_BYTES + length || width === 0 || height === 0) {
        throw new Error('Invalid device helper frame');
    }
    return {
        sequence: header.getUint32(4),
        width,
        height,
        data: payload.slice(LIVE_STREAM_FRAME_HEADER_BYTES)
    };
};
