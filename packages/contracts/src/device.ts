import { z } from 'zod';

const DeviceIdSchema = z.string().min(1).max(256);
const DeviceCoordinateSchema = z.number().finite().min(0).max(1);
const DeviceFrameSizeSchema = z.number().int().min(1).max(8192);

export const DevicePlatformSchema = z.enum(['ios', 'android']);
export const DeviceKindSchema = z.enum(['simulator', 'physical']);
export const DeviceStateSchema = z.enum(['booted', 'shutdown', 'transitioning']);

export const DeviceVideoFormatSchema = z.enum(['jpeg', 'hevc', 'h264']);
export const DeviceButtonSchema = z.enum(['home', 'back', 'swipeHome', 'appSwitcher', 'lock', 'siri', 'volumeUp', 'volumeDown', 'power', 'playPause']);
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
    'push',
    'capture',
    'record',
    'clipboard',
    'keyboard',
    'statusBar',
    'battery',
    'biometrics',
    'shake',
    'memoryWarning',
    'installApp',
    'addMedia',
    'erase',
    'fold',
    'camera'
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
    /* Absent means the buttons of an iPhone, which is what a physical iPhone announces. */
    buttons: AnnouncedListSchema.optional(),
    /* Absent means every tool on an iOS simulator and none elsewhere. */
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
export function deviceMatches(device: DeviceInfo, reference: DeviceReference): boolean {
    return device.platform === reference.platform && device.kind === reference.kind && device.name === reference.name && device.runtime === reference.runtime;
}

export const DeviceTargetPayloadSchema = z.object({
    deviceId: DeviceIdSchema,
    backendId: z.string().min(1).max(64),
    platform: DevicePlatformSchema
});

export const DeviceOpenPayloadSchema = DeviceTargetPayloadSchema.extend({
    stream: z.enum(['http', 'events']).optional(),
    // Asks for the frames of `events` as binary live frames; a connection that cannot carry them gets base64 in JSON.
    binary: z.boolean().optional(),
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

export const DeviceStatusBarSchema = z.enum(['clean', 'default']);
export const DeviceFoldPoseSchema = z.enum(['closed', 'tent', 'tabletop', 'book', 'open']);
const DeviceBatteryLevelSchema = z.number().int().min(0).max(100);
const DeviceHingeSchema = z.number().int().min(0).max(180);

export const DeviceSettingsSchema = z.object({
    appearance: DeviceAppearanceSchema.optional(),
    textSize: DeviceTextSizeSchema.optional(),
    reduceMotion: z.boolean().optional(),
    increaseContrast: z.boolean().optional(),
    reduceTransparency: z.boolean().optional(),
    showBorders: z.boolean().optional(),
    voiceOver: z.boolean().optional(),
    liquidGlass: z.enum(['clear', 'tinted']).optional(),
    colorFilter: DeviceColorFilterSchema.optional(),
    statusBar: DeviceStatusBarSchema.optional(),
    battery: z.object({ level: DeviceBatteryLevelSchema, charging: z.boolean() }).optional(),
    biometricEnrolled: z.boolean().optional(),
    /* The hinge of a foldable in degrees, 0 closed and 180 flat. */
    hinge: DeviceHingeSchema.optional(),
    /* Which screen of a foldable the picture shows. */
    panel: z.enum(['cover', 'inner']).optional(),
    /* A recording is held: running, or ended on its own and not stopped yet. */
    recording: z.boolean().optional(),
    /* The held recording ended on its own (its limit); stopping it only hands over its video. */
    recordingEnded: z.boolean().optional()
});

export const DeviceDetailSchema = DeviceTargetPayloadSchema.extend({ settings: DeviceSettingsSchema });

/* A phone's own battery as it last read it, or the fake level apps see while one is set (`simulated`). */
export const DevicePowerSchema = z.object({
    level: DeviceBatteryLevelSchema,
    plugged: z.boolean(),
    charging: z.boolean(),
    /* What it hangs on when the phone says, such as `ac`, `usb` or `wireless`; open, since a phone may name a dock tomorrow. */
    source: z.string().min(1).max(16).optional(),
    simulated: z.boolean().optional()
});

/* Null where the battery cannot be read: a simulator, an emulator, or a phone that did not answer. */
export const DevicePowerResultSchema = z.object({ power: DevicePowerSchema.nullable() });
export const DeviceDetailPayloadSchema = DeviceTargetPayloadSchema;

const DeviceActionTarget = DeviceTargetPayloadSchema.shape;
const DeviceAppIdSchema = z.string().trim().min(1).max(256);
/* An absolute path on the machine, never an upload; the daemon decides whether it may be read. */
const DeviceMachinePathSchema = z.string().min(1).max(4096);

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
    z.object({ ...DeviceActionTarget, action: z.literal('sendPush'), appId: DeviceAppIdSchema, payload: z.string().min(1).max(16_384) }),
    z.object({ ...DeviceActionTarget, action: z.literal('setStatusBar'), value: DeviceStatusBarSchema }),
    z.object({ ...DeviceActionTarget, action: z.literal('setBattery'), level: DeviceBatteryLevelSchema, charging: z.boolean() }),
    z.object({ ...DeviceActionTarget, action: z.literal('resetBattery') }),
    z.object({
        ...DeviceActionTarget,
        action: z.literal('biometric'),
        sensor: z.enum(['face', 'finger']),
        event: z.enum(['enroll', 'unenroll', 'match', 'nomatch'])
    }),
    z.object({ ...DeviceActionTarget, action: z.literal('shake') }),
    z.object({ ...DeviceActionTarget, action: z.literal('memoryWarning') }),
    z.object({ ...DeviceActionTarget, action: z.literal('setAllPermissions'), appId: DeviceAppIdSchema, decision: z.enum(['grant', 'revoke', 'reset']) }),
    z.object({ ...DeviceActionTarget, action: z.literal('installApp'), path: DeviceMachinePathSchema }),
    z.object({ ...DeviceActionTarget, action: z.literal('addMedia'), paths: z.array(DeviceMachinePathSchema).min(1).max(20) }),
    z.object({ ...DeviceActionTarget, action: z.literal('erase') }),
    z.object({ ...DeviceActionTarget, action: z.literal('setFold'), value: DeviceFoldPoseSchema }),
    z.object({ ...DeviceActionTarget, action: z.literal('setHinge'), degrees: DeviceHingeSchema }),
    z.object({
        ...DeviceActionTarget,
        action: z.literal('setCamera'),
        appId: DeviceAppIdSchema,
        source: z.enum(['placeholder', 'file', 'off']),
        path: DeviceMachinePathSchema.optional()
    })
]);

/* A png of the screen, written on the machine for the client to read over `bytes.read`. */
export const DeviceCaptureResultSchema = z.object({
    path: DeviceMachinePathSchema,
    width: z.number().int().min(1).max(32_768),
    height: z.number().int().min(1).max(32_768)
});

/*
 * A png another machine captured of one of its devices, written into this machine's captures so a view of
 * this project can show it. Base64 in one frame, held to the size a live frame of a device may have.
 */
export const DeviceImportCapturePayloadSchema = z.object({
    deviceId: DeviceIdSchema,
    data: z.string().max(11 * 1024 * 1024)
});

export const DeviceRecordPayloadSchema = DeviceTargetPayloadSchema.extend({ mode: z.enum(['start', 'stop']) });

/* `path` is the finished video, set only by a stop. */
export const DeviceRecordResultSchema = z.object({ recording: z.boolean(), path: DeviceMachinePathSchema.optional() });

/* Without `text` it reads the device clipboard; `paste` also presses paste where the focus is. */
export const DeviceClipboardPayloadSchema = DeviceTargetPayloadSchema.extend({
    text: z.string().max(1_048_576).optional(),
    paste: z.boolean().optional()
});

export const DeviceClipboardResultSchema = z.object({ text: z.string().max(1_048_576) });

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

/* One key of a person's keyboard as a USB HID usage of the keyboard page (7). */
const DeviceKeyInputSchema = z.object({
    kind: z.literal('key'),
    phase: z.enum(['down', 'up']),
    usage: z.number().int().min(1).max(0xffff)
});

export const DeviceInputSchema = z.discriminatedUnion('kind', [
    DevicePointerInputSchema,
    DeviceMultiPointerInputSchema,
    DeviceScrollInputSchema,
    DeviceButtonInputSchema,
    DeviceRotateInputSchema,
    DeviceKeyInputSchema
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

/*
 * What an agent did last on a device, for the strip on its node. The kind is a plain string (tap,
 * swipe, type, button, launch, shot), so a daemon that learns a new one does not make an older
 * client refuse the event; the description says it in words for a client that does not know it.
 */
export const DeviceAgentStepSchema = z.object({
    kind: z.string().min(1).max(32),
    // The button pressed or the app opened; absent for the other kinds.
    target: z.string().min(1).max(256).optional(),
    description: z.string().min(1).max(300),
    // Where a tap landed, as the share of the screen from its top-left corner; absent for the other kinds.
    x: DeviceCoordinateSchema.optional(),
    y: DeviceCoordinateSchema.optional(),
    // Counts up with every step on the machine, so a second tap on the same spot reads as a new one.
    seq: z.number().int().min(0)
});

/* Who has a device an agent operates: the agent, or the person, who paused it or took over by hand. `ended` once the agent let go. */
export const DeviceOperatedStateSchema = z.enum(['running', 'paused', 'takenOver', 'ended']);

export const DeviceOperatedSchema = z.object({
    backendId: z.string().min(1).max(64),
    deviceId: DeviceIdSchema,
    // The chat or terminal whose agent operates the device; null when the machine does not know it.
    nodeId: z.string().min(1).nullable(),
    state: DeviceOperatedStateSchema,
    step: DeviceAgentStepSchema.nullable()
});

export const DeviceOperationsResultSchema = z.object({ devices: z.array(DeviceOperatedSchema) });

/* The buttons of the strip on a device node an agent operates, which any client of the person may press. */
export const DeviceControlModeSchema = z.enum(['pause', 'resume', 'takeOver']);

export const DeviceControlPayloadSchema = z.object({
    backendId: z.string().min(1).max(64),
    deviceId: DeviceIdSchema,
    mode: DeviceControlModeSchema
});

/* The announced entries this version knows, in the order they were announced. */
function known<Value extends string>(schema: z.ZodEnum<Record<Value, Value>>, announced: readonly string[]): Value[] {
    return announced.filter((entry): entry is Value => schema.safeParse(entry).success);
}

const IOS_BUTTONS: readonly DeviceButton[] = ['home', 'swipeHome', 'appSwitcher', 'lock', 'siri'];
/* What a simulator could do before a daemon announced its tools; one that announces them says the rest. */
const IOS_SIMULATOR_TOOLS: readonly DeviceTool[] = [
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
];

export function deviceButtons(device: Pick<DeviceInfo, 'capabilities'>): DeviceButton[] {
    return device.capabilities.buttons ? known(DeviceButtonSchema, device.capabilities.buttons) : [...IOS_BUTTONS];
}

export function deviceTools(device: Pick<DeviceInfo, 'capabilities' | 'kind' | 'platform'>): DeviceTool[] {
    if (device.capabilities.tools) {
        return known(DeviceToolSchema, device.capabilities.tools);
    }
    return device.platform === 'ios' && device.kind === 'simulator' ? [...IOS_SIMULATOR_TOOLS] : [];
}

export function devicePermissions(device: Pick<DeviceInfo, 'capabilities'>): DevicePermission[] {
    return device.capabilities.permissions ? known(DevicePermissionSchema, device.capabilities.permissions) : [...DevicePermissionSchema.options];
}

export type DeviceInfo = z.infer<typeof DeviceInfoSchema>;
export type DeviceButton = z.infer<typeof DeviceButtonSchema>;
export type DeviceTool = z.infer<typeof DeviceToolSchema>;
export type DeviceUnavailable = z.infer<typeof DeviceUnavailableSchema>;
export type DeviceVideoFormat = z.infer<typeof DeviceVideoFormatSchema>;
export type DeviceCapabilities = z.infer<typeof DeviceCapabilitiesSchema>;
export type DeviceAction = z.infer<typeof DeviceActionPayloadSchema>;
export type DeviceAgentStep = z.infer<typeof DeviceAgentStepSchema>;
export type DeviceAppearance = z.infer<typeof DeviceAppearanceSchema>;
export type DeviceColorFilter = z.infer<typeof DeviceColorFilterSchema>;
export type DeviceCaptureResult = z.infer<typeof DeviceCaptureResultSchema>;
export type DeviceImportCapturePayload = z.infer<typeof DeviceImportCapturePayloadSchema>;
export type DeviceClipboardPayload = z.infer<typeof DeviceClipboardPayloadSchema>;
export type DeviceFoldPose = z.infer<typeof DeviceFoldPoseSchema>;
export type DeviceRecordResult = z.infer<typeof DeviceRecordResultSchema>;
export type DeviceStatusBar = z.infer<typeof DeviceStatusBarSchema>;
export type DeviceControlMode = z.infer<typeof DeviceControlModeSchema>;
export type DeviceControlPayload = z.infer<typeof DeviceControlPayloadSchema>;
export type DeviceDetail = z.infer<typeof DeviceDetailSchema>;
export type DeviceInput = z.infer<typeof DeviceInputSchema>;
export type DeviceFrame = z.infer<typeof DeviceFrameSchema>;
export type DeviceKind = z.infer<typeof DeviceKindSchema>;
export type DeviceOpenResult = z.infer<typeof DeviceOpenResultSchema>;
export type DeviceOperated = z.infer<typeof DeviceOperatedSchema>;
export type DeviceOperatedState = z.infer<typeof DeviceOperatedStateSchema>;
export type DevicePermission = z.infer<typeof DevicePermissionSchema>;
export type DevicePlatform = z.infer<typeof DevicePlatformSchema>;
export type DevicePower = z.infer<typeof DevicePowerSchema>;
export type DeviceReference = z.infer<typeof DeviceReferenceSchema>;
export type DeviceSettings = z.infer<typeof DeviceSettingsSchema>;
export type DeviceState = z.infer<typeof DeviceStateSchema>;
export type DeviceTextSize = z.infer<typeof DeviceTextSizeSchema>;
export type DeviceToggleSetting = z.infer<typeof DeviceToggleSettingSchema>;
