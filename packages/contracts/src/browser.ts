import { z } from 'zod';

const BrowserIdSchema = z.string().min(1).max(256);
const BrowserSizeSchema = z.number().int().min(1).max(4096);
const BrowserFrameSizeSchema = z.number().int().min(1).max(8192);
const BrowserDeviceScaleFactorSchema = z.number().finite().min(1).max(2);
const BrowserCoordinateSchema = z.number().finite().min(-4096).max(8192);
const BrowserModifiersSchema = z.number().int().min(0).max(15).optional();

export const BROWSER_FAVICON_MAX_BYTES = 128 * 1024;
export const BROWSER_FAVICON_MAX_DATA_URL_LENGTH = 180_000;

export const BrowserTargetPayloadSchema = z.object({ browserId: BrowserIdSchema });

export const BrowserOpenPayloadSchema = BrowserTargetPayloadSchema.extend({
    url: z.string().max(8192),
    width: BrowserSizeSchema,
    height: BrowserSizeSchema,
    deviceScaleFactor: BrowserDeviceScaleFactorSchema.optional(),
    stream: z.enum(['http', 'events']).optional()
});

export const BrowserNavigatePayloadSchema = BrowserTargetPayloadSchema.extend({ url: z.string().max(8192) });

export const BrowserResizePayloadSchema = BrowserTargetPayloadSchema.extend({
    width: BrowserSizeSchema,
    height: BrowserSizeSchema,
    deviceScaleFactor: BrowserDeviceScaleFactorSchema.optional()
});

export const BrowserCommandPayloadSchema = BrowserTargetPayloadSchema.extend({
    command: z.enum(['back', 'forward', 'reload', 'stop']),
    ignoreCache: z.boolean().optional()
});

const PointerInputSchema = z.object({
    kind: z.literal('pointer'),
    phase: z.enum(['down', 'move', 'up']),
    x: BrowserCoordinateSchema,
    y: BrowserCoordinateSchema,
    button: z.enum(['left', 'middle', 'right']).optional(),
    buttons: z.number().int().min(0).max(7).optional(),
    modifiers: BrowserModifiersSchema
});

const WheelInputSchema = z.object({
    kind: z.literal('wheel'),
    x: BrowserCoordinateSchema,
    y: BrowserCoordinateSchema,
    deltaX: z.number().finite().min(-10000).max(10000),
    deltaY: z.number().finite().min(-10000).max(10000),
    modifiers: BrowserModifiersSchema
});

const KeyInputSchema = z.object({
    kind: z.literal('key'),
    phase: z.enum(['down', 'up']),
    key: z.string().max(128),
    code: z.string().max(128),
    text: z.string().max(16).optional(),
    modifiers: BrowserModifiersSchema
});

const TextInputSchema = z.object({ kind: z.literal('text'), text: z.string().max(65536) });

export const BrowserInputPayloadSchema = BrowserTargetPayloadSchema.extend({
    input: z.discriminatedUnion('kind', [PointerInputSchema, WheelInputSchema, KeyInputSchema, TextInputSchema])
});

export const BrowserInfoSchema = z.object({
    browserId: BrowserIdSchema,
    url: z.string(),
    title: z.string(),
    loading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    error: z.string().nullable(),
    streamId: z.string().min(1).max(256).optional(),
    favicon: z
        .string()
        .max(BROWSER_FAVICON_MAX_DATA_URL_LENGTH)
        .regex(/^data:image\/[a-z0-9.+-]+;base64,[a-z0-9+/]+=*$/i)
        .nullable()
        .optional()
});

export const BrowserFrameSchema = z.object({
    browserId: BrowserIdSchema,
    sequence: z.number().int().min(0).max(0xffffffff),
    width: BrowserFrameSizeSchema,
    height: BrowserFrameSizeSchema,
    data: z.string().max(11 * 1024 * 1024)
});

export type BrowserInfo = z.infer<typeof BrowserInfoSchema>;
export type BrowserFrame = z.infer<typeof BrowserFrameSchema>;
export type BrowserInput = z.infer<typeof BrowserInputPayloadSchema>['input'];

export const LIVE_STREAM_CONTENT_TYPE = 'application/x-ruimte-jpeg-stream; version=1';
export const LIVE_STREAM_MAGIC = new Uint8Array([0x52, 0x53, 0x54, 0x4d, 0x01, 0x00, 0x00, 0x00]);
export const LIVE_STREAM_FRAME_HEADER_BYTES = 12;
export const LIVE_STREAM_MAX_FRAME_BYTES = 8 * 1024 * 1024;

export interface LiveStreamFrame {
    sequence: number;
    width: number;
    height: number;
    data: Uint8Array;
}

export const encodeLiveStreamFrame = (frame: LiveStreamFrame): Uint8Array => {
    if (frame.data.byteLength > LIVE_STREAM_MAX_FRAME_BYTES) {
        throw new Error('Live stream frame is too large');
    }
    if (!Number.isInteger(frame.sequence) || frame.sequence < 0 || frame.sequence > 0xffffffff) {
        throw new Error('Live stream sequence is outside uint32');
    }
    if (
        !Number.isInteger(frame.width) ||
        !Number.isInteger(frame.height) ||
        frame.width < 1 ||
        frame.height < 1 ||
        frame.width > 0xffff ||
        frame.height > 0xffff
    ) {
        throw new Error('Live stream dimensions are outside uint16');
    }
    const encoded = new Uint8Array(LIVE_STREAM_FRAME_HEADER_BYTES + frame.data.byteLength);
    const header = new DataView(encoded.buffer);
    header.setUint32(0, frame.data.byteLength);
    header.setUint32(4, frame.sequence);
    header.setUint16(8, frame.width);
    header.setUint16(10, frame.height);
    encoded.set(frame.data, LIVE_STREAM_FRAME_HEADER_BYTES);
    return encoded;
};

export class LiveStreamDecoder {
    private buffer = new Uint8Array();
    private preambleRead = false;

    push(chunk: Uint8Array): LiveStreamFrame[] {
        const joined = new Uint8Array(this.buffer.byteLength + chunk.byteLength);
        joined.set(this.buffer);
        joined.set(chunk, this.buffer.byteLength);
        this.buffer = joined;

        if (!this.preambleRead) {
            if (this.buffer.byteLength < LIVE_STREAM_MAGIC.byteLength) {
                return [];
            }
            for (let index = 0; index < LIVE_STREAM_MAGIC.byteLength; index += 1) {
                if (this.buffer[index] !== LIVE_STREAM_MAGIC[index]) {
                    throw new Error('Unknown live stream format');
                }
            }
            this.buffer = this.buffer.slice(LIVE_STREAM_MAGIC.byteLength);
            this.preambleRead = true;
        }

        const frames: LiveStreamFrame[] = [];
        while (this.buffer.byteLength >= LIVE_STREAM_FRAME_HEADER_BYTES) {
            const header = new DataView(this.buffer.buffer, this.buffer.byteOffset, LIVE_STREAM_FRAME_HEADER_BYTES);
            const length = header.getUint32(0);
            if (length > LIVE_STREAM_MAX_FRAME_BYTES) {
                throw new Error('Live stream frame is too large');
            }
            const total = LIVE_STREAM_FRAME_HEADER_BYTES + length;
            if (this.buffer.byteLength < total) {
                break;
            }
            frames.push({
                sequence: header.getUint32(4),
                width: header.getUint16(8),
                height: header.getUint16(10),
                data: this.buffer.slice(LIVE_STREAM_FRAME_HEADER_BYTES, total)
            });
            this.buffer = this.buffer.slice(total);
        }
        return frames;
    }
}
