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
