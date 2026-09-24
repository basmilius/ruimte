import { z } from 'zod';

const DeviceIdSchema = z.string().min(1).max(256);
const DeviceCoordinateSchema = z.number().finite().min(0).max(1);
const DeviceFrameSizeSchema = z.number().int().min(1).max(8192);

export const DevicePlatformSchema = z.enum(['ios', 'android']);
export const DeviceKindSchema = z.enum(['simulator', 'physical']);
export const DeviceStateSchema = z.enum(['booted', 'shutdown', 'transitioning']);

export const DeviceVideoFormatSchema = z.enum(['jpeg', 'hevc', 'h264']);
export const DeviceButtonSchema = z.enum(['home', 'back', 'swipeHome', 'appSwitcher', 'lock', 'siri']);
export const DeviceToolSchema = z.enum([
    'openUrl',
    'launchApp',
    'terminateApp',
    'appearance',
    'textSize',
    'liquidGlass',
    'colorFilter',
    'reduceMotion',
    'increaseContrast',
    'reduceTransparency',
    'showBorders',
    'voiceOver',
    'location',
    'clearLocation',
    'permissions',
    'push'
]);

/*
 * The lists a device announces are plain strings on the wire, so a daemon that learns a new button
 * or tool does not make an older client refuse the whole device list; a client keeps what it knows.
 */
const AnnouncedListSchema = z.array(z.string().min(1).max(64)).max(64);

export const DeviceCapabilitiesSchema = z.object({
    boot: z.boolean(),
    shutdown: z.boolean(),
    stream: z.boolean(),
    input: z.boolean(),
    screenshot: z.boolean(),
    /* Absent from a daemon that predates it, which only had the buttons of an iPhone. */
    buttons: AnnouncedListSchema.optional(),
    /* Absent from a daemon that predates it, which offered every tool on an iOS simulator and none elsewhere. */
    tools: AnnouncedListSchema.optional(),
    permissions: AnnouncedListSchema.optional()
});

export const DeviceReferenceSchema = z.object({
    platform: DevicePlatformSchema,
    kind: DeviceKindSchema,
    name: z.string().min(1).max(256),
    runtime: z.string().min(1).max(256)
});

export const DeviceInfoSchema = z.object({
    deviceId: DeviceIdSchema,
    backendId: z.string().min(1).max(64),
    platform: DevicePlatformSchema,
    kind: DeviceKindSchema,
    name: z.string().min(1).max(256),
    runtime: z.string().min(1).max(256),
    state: DeviceStateSchema,
    /* Why a device is in its state when that takes the person to act, such as `unauthorized` for a phone that has not allowed debugging yet. */
    reason: z.string().min(1).max(64).optional(),
    capabilities: DeviceCapabilitiesSchema
});

export const DeviceUnavailableSchema = z.object({
    platform: DevicePlatformSchema,
    code: z.string().min(1).max(64),
    message: z.string().max(1024)
});

export const DeviceListResultSchema = z.object({
    devices: z.array(DeviceInfoSchema),
    /* The kinds of device this machine could not look for, next to the ones it found. */
    unavailable: z.array(DeviceUnavailableSchema).max(16).optional()
});

/*
 * Whether a device is the one a reference points at. A reference names a device the way a person
 * does, since the id is the machine's and a project file that travels to another machine would
 * carry an id that means nothing there.
 */
export const deviceMatches = (device: DeviceInfo, reference: DeviceReference): boolean =>
    device.platform === reference.platform && device.kind === reference.kind && device.name === reference.name && device.runtime === reference.runtime;

export const DeviceTargetPayloadSchema = z.object({
    deviceId: DeviceIdSchema,
    backendId: z.string().min(1).max(64),
    platform: DevicePlatformSchema
});

export const DeviceOpenPayloadSchema = DeviceTargetPayloadSchema.extend({
    stream: z.enum(['http', 'events']).optional(),
    /* What the client can draw. Absent means a client from before H.264, which draws JPEG and HEVC. */
    formats: z.array(DeviceVideoFormatSchema).max(8).optional()
});

export const DeviceOpenResultSchema = DeviceInfoSchema.extend({
    streamId: z.string().min(1).max(256)
});

export const DeviceAppearanceSchema = z.enum(['light', 'dark']);
export const DeviceTextSizeSchema = z.enum(['small', 'default', 'large', 'extra-large']);
export const DeviceColorFilterSchema = z.enum(['none', 'grayscale', 'red-green', 'green-red', 'blue-yellow']);
export const DeviceToggleSettingSchema = z.enum(['reduceMotion', 'increaseContrast', 'reduceTransparency', 'showBorders', 'voiceOver']);
export const DevicePermissionSchema = z.enum([
    'camera',
    'microphone',
    'photos',
    'contacts',
    'calendar',
    'reminders',
    'location',
    'motion',
    'media-library',
    'faceid'
]);

export const DeviceSettingsSchema = z.object({
    appearance: DeviceAppearanceSchema.optional(),
    textSize: DeviceTextSizeSchema.optional(),
    reduceMotion: z.boolean().optional(),
    increaseContrast: z.boolean().optional(),
    reduceTransparency: z.boolean().optional(),
    showBorders: z.boolean().optional(),
    voiceOver: z.boolean().optional(),
    liquidGlass: z.enum(['clear', 'tinted']).optional(),
    colorFilter: DeviceColorFilterSchema.optional()
});

export const DeviceDetailSchema = DeviceTargetPayloadSchema.extend({ settings: DeviceSettingsSchema });
export const DeviceDetailPayloadSchema = DeviceTargetPayloadSchema;

const DeviceActionTarget = DeviceTargetPayloadSchema.shape;
const DeviceAppIdSchema = z.string().trim().min(1).max(256);

export const DeviceActionPayloadSchema = z.discriminatedUnion('action', [
    z.object({ ...DeviceActionTarget, action: z.literal('setAppearance'), value: DeviceAppearanceSchema }),
    z.object({ ...DeviceActionTarget, action: z.literal('setTextSize'), value: DeviceTextSizeSchema }),
    z.object({ ...DeviceActionTarget, action: z.literal('setToggle'), setting: DeviceToggleSettingSchema, value: z.boolean() }),
    z.object({ ...DeviceActionTarget, action: z.literal('setLiquidGlass'), value: z.enum(['clear', 'tinted']) }),
    z.object({ ...DeviceActionTarget, action: z.literal('setColorFilter'), value: DeviceColorFilterSchema }),
    z.object({
        ...DeviceActionTarget,
        action: z.literal('setLocation'),
        latitude: z.number().finite().min(-90).max(90),
        longitude: z.number().finite().min(-180).max(180)
    }),
    z.object({ ...DeviceActionTarget, action: z.literal('clearLocation') }),
    z.object({
        ...DeviceActionTarget,
        action: z.literal('setPermission'),
        appId: DeviceAppIdSchema,
        permission: DevicePermissionSchema,
        decision: z.enum(['grant', 'revoke', 'reset'])
    }),
    z.object({ ...DeviceActionTarget, action: z.literal('openUrl'), url: z.string().trim().min(1).max(2048) }),
    z.object({ ...DeviceActionTarget, action: z.literal('launchApp'), appId: DeviceAppIdSchema }),
    z.object({ ...DeviceActionTarget, action: z.literal('terminateApp'), appId: DeviceAppIdSchema }),
    z.object({ ...DeviceActionTarget, action: z.literal('sendPush'), appId: DeviceAppIdSchema, payload: z.string().min(1).max(16_384) })
]);

const DevicePointerInputSchema = z.object({
    kind: z.literal('pointer'),
    phase: z.enum(['down', 'move', 'up']),
    x: DeviceCoordinateSchema,
    y: DeviceCoordinateSchema,
    edge: z.enum(['bottom']).optional()
});

const DeviceMultiPointerInputSchema = z.object({
    kind: z.literal('multiPointer'),
    phase: z.enum(['down', 'move', 'up']),
    first: z.object({ x: DeviceCoordinateSchema, y: DeviceCoordinateSchema }),
    second: z.object({ x: DeviceCoordinateSchema, y: DeviceCoordinateSchema })
});

const DeviceScrollInputSchema = z.object({
    kind: z.literal('scroll'),
    deltaX: z.number().finite().min(-1_000_000).max(1_000_000),
    deltaY: z.number().finite().min(-1_000_000).max(1_000_000),
    x: DeviceCoordinateSchema,
    y: DeviceCoordinateSchema
});

const DeviceButtonInputSchema = z.object({
    kind: z.literal('button'),
    button: DeviceButtonSchema
});

const DeviceRotateInputSchema = z.object({
    kind: z.literal('rotate'),
    direction: z.enum(['left', 'right'])
});

export const DeviceInputSchema = z.discriminatedUnion('kind', [
    DevicePointerInputSchema,
    DeviceMultiPointerInputSchema,
    DeviceScrollInputSchema,
    DeviceButtonInputSchema,
    DeviceRotateInputSchema
]);

export const DeviceInputPayloadSchema = DeviceTargetPayloadSchema.extend({ input: DeviceInputSchema });

export const DeviceFrameSchema = z.object({
    deviceId: DeviceIdSchema,
    backendId: z.string().min(1).max(64),
    platform: DevicePlatformSchema,
    sequence: z.number().int().min(0).max(0xffffffff),
    width: DeviceFrameSizeSchema,
    height: DeviceFrameSizeSchema,
    format: DeviceVideoFormatSchema.optional(),
    // Set on the frames of a video stream only: after a gap, the one to start decoding from again.
    keyFrame: z.boolean().optional(),
    data: z.string().max(11 * 1024 * 1024)
});

/* The announced entries this version knows, in the order they were announced. */
const known = <Value extends string>(schema: z.ZodEnum<Record<Value, Value>>, announced: readonly string[]): Value[] =>
    announced.filter((entry): entry is Value => schema.safeParse(entry).success);

const IOS_BUTTONS: readonly DeviceButton[] = ['home', 'swipeHome', 'appSwitcher', 'lock', 'siri'];
const IOS_SIMULATOR_TOOLS: readonly DeviceTool[] = DeviceToolSchema.options;

export const deviceButtons = (device: Pick<DeviceInfo, 'capabilities'>): DeviceButton[] =>
    device.capabilities.buttons ? known(DeviceButtonSchema, device.capabilities.buttons) : [...IOS_BUTTONS];

export const deviceTools = (device: Pick<DeviceInfo, 'capabilities' | 'kind' | 'platform'>): DeviceTool[] => {
    if (device.capabilities.tools) {
        return known(DeviceToolSchema, device.capabilities.tools);
    }
    return device.platform === 'ios' && device.kind === 'simulator' ? [...IOS_SIMULATOR_TOOLS] : [];
};

export const devicePermissions = (device: Pick<DeviceInfo, 'capabilities'>): DevicePermission[] =>
    device.capabilities.permissions ? known(DevicePermissionSchema, device.capabilities.permissions) : [...DevicePermissionSchema.options];

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;
export type DeviceButton = z.infer<typeof DeviceButtonSchema>;
export type DeviceTool = z.infer<typeof DeviceToolSchema>;
export type DeviceUnavailable = z.infer<typeof DeviceUnavailableSchema>;
export type DeviceVideoFormat = z.infer<typeof DeviceVideoFormatSchema>;
export type DeviceCapabilities = z.infer<typeof DeviceCapabilitiesSchema>;
export type DeviceAction = z.infer<typeof DeviceActionPayloadSchema>;
export type DeviceAppearance = z.infer<typeof DeviceAppearanceSchema>;
export type DeviceColorFilter = z.infer<typeof DeviceColorFilterSchema>;
export type DeviceDetail = z.infer<typeof DeviceDetailSchema>;
export type DeviceInput = z.infer<typeof DeviceInputSchema>;
export type DeviceFrame = z.infer<typeof DeviceFrameSchema>;
export type DeviceKind = z.infer<typeof DeviceKindSchema>;
export type DeviceOpenResult = z.infer<typeof DeviceOpenResultSchema>;
export type DevicePermission = z.infer<typeof DevicePermissionSchema>;
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;
export type DeviceReference = z.infer<typeof DeviceReferenceSchema>;
export type DeviceSettings = z.infer<typeof DeviceSettingsSchema>;
export type DeviceState = z.infer<typeof DeviceStateSchema>;
export type DeviceTextSize = z.infer<typeof DeviceTextSizeSchema>;
export type DeviceToggleSetting = z.infer<typeof DeviceToggleSettingSchema>;
