import { z } from 'zod';

const DeviceIdSchema = z.string().min(1).max(256);
const DeviceCoordinateSchema = z.number().finite().min(0).max(1);
const DeviceFrameSizeSchema = z.number().int().min(1).max(8192);

export const DevicePlatformSchema = z.enum(['ios', 'android']);
export const DeviceKindSchema = z.enum(['simulator', 'physical']);
export const DeviceStateSchema = z.enum(['booted', 'shutdown', 'transitioning']);

export const DeviceCapabilitiesSchema = z.object({
    boot: z.boolean(),
    shutdown: z.boolean(),
    stream: z.boolean(),
    input: z.boolean(),
    screenshot: z.boolean()
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
    capabilities: DeviceCapabilitiesSchema
});

export const DeviceListResultSchema = z.object({ devices: z.array(DeviceInfoSchema) });

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
    stream: z.enum(['http', 'events']).optional()
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
    button: z.enum(['home', 'swipeHome', 'appSwitcher', 'lock', 'siri'])
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
    format: z.enum(['jpeg', 'hevc']).optional(),
    data: z.string().max(11 * 1024 * 1024)
});

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;
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
