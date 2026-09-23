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

const DevServerPortSchema = z.number().int().min(1).max(65535);

/* The ports a splash asks about at once, which is the table in `apps/client/src/browser/dev-servers.ts`. */
export const BrowserDevServersPayloadSchema = z.object({ ports: z.array(DevServerPortSchema).min(1).max(32) });

export const DevServerSchema = z.object({
    port: DevServerPortSchema,
    /* What the page at the root of that port calls itself, where it answered with a name. */
    title: z.string().max(200).optional()
});

export const BrowserDevServersResultSchema = z.object({ servers: z.array(DevServerSchema).max(32) });

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
export type DevServer = z.infer<typeof DevServerSchema>;

/*
 * What an agent may ask of a page it has a line to: where to go, through the history it already
 * has, and a picture of what stands there. Never a click, a keystroke or a scroll: an agent works
 * a page by its address, and typing into one is a person's.
 */
export const BrowserDriveActionSchema = z.discriminatedUnion('kind', [
    z.object({ kind: z.literal('state') }),
    z.object({ kind: z.literal('go'), url: z.string().max(8192) }),
    z.object({ kind: z.literal('back') }),
    z.object({ kind: z.literal('forward') }),
    z.object({ kind: z.literal('reload'), ignoreCache: z.boolean().optional() }),
    z.object({ kind: z.literal('stop') }),
    z.object({ kind: z.literal('shot') }),
    /* What the page says; a client from before this leaves it unanswered, so the page reads without its text. */
    z.object({ kind: z.literal('text') })
]);

/*
 * Where a page stands, as the client that holds it knows it. Smaller than `BrowserInfo` on purpose:
 * a stream and an icon belong to the client drawing the page, and neither says anything to an agent.
 */
export const BrowserPageStateSchema = z.object({
    browserId: BrowserIdSchema,
    url: z.string().max(8192),
    title: z.string().max(1024),
    loading: z.boolean(),
    canGoBack: z.boolean(),
    canGoForward: z.boolean(),
    /* What the last load failed on, in the browser's own words; null when it arrived. */
    error: z.string().max(1024).nullable()
});

/* A client telling the daemon it has this page open, and where the page stands now. */
export const BrowserHoldPayloadSchema = z.object({ state: BrowserPageStateSchema });

/* One ask, to the clients holding that page. `askId` is what the answer comes back under. */
export const BrowserDriveEventSchema = z.object({
    askId: z.string().min(1).max(128),
    browserId: BrowserIdSchema,
    action: BrowserDriveActionSchema
});

export const BROWSER_TEXT_MAX_CHARS = 40_000;

/* What a page says as a reader sees it, the same on the daemon's own page and in a client's <webview>:
   `innerText` leaves out what is hidden and keeps the line breaks the layout makes. */
export const PAGE_TEXT_EXPRESSION = `(document.body ? document.body.innerText : '').slice(0, ${BROWSER_TEXT_MAX_CHARS})`;

/* A png of the page, base64, which is only ever the answer to a shot. */
const BrowserShotSchema = z.string().max(16 * 1024 * 1024);

export const BrowserDriveResultPayloadSchema = z.object({
    askId: z.string().min(1).max(128),
    state: BrowserPageStateSchema.optional(),
    image: BrowserShotSchema.optional(),
    /* The visible text of the page, which is only ever the answer to a text ask. */
    text: z.string().max(BROWSER_TEXT_MAX_CHARS).optional(),
    /* Why it did not happen; absent when it did. */
    error: z.string().max(1024).optional()
});

export type BrowserDriveAction = z.infer<typeof BrowserDriveActionSchema>;
export type BrowserPageState = z.infer<typeof BrowserPageStateSchema>;
export type BrowserDriveEvent = z.infer<typeof BrowserDriveEventSchema>;
export type BrowserDriveResult = z.infer<typeof BrowserDriveResultPayloadSchema>;
