import { BrokerSettingSchema } from '@ruimte/pulsar';
import { z } from 'zod';
import { KeepAwakeModeSchema } from './keep-awake.ts';
import { TextModelChoiceSchema } from './text-model.ts';

/* The longest folder a machine keeps to start browsing in. */
export const START_FOLDER_MAX = 4096;

export const TerminalShellSchema = z.enum(['powershell', 'git-bash', 'cmd', 'wsl']);
export type TerminalShell = z.infer<typeof TerminalShellSchema>;

/*
 * The sizes a person gave new nodes on a machine, by kind; a kind left out takes its built-in size.
 * Open on purpose: a newer machine may name a kind or allow a size an older client never heard of,
 * and a client that validates the whole reply must not refuse the machine over it.
 */
export const EndpointNodeSizesSchema = z.record(z.string(), z.object({ w: z.number(), h: z.number() }));

/*
 * One row of what a person sets on a machine. `endpoint.info`, `endpoint.changed`, `endpoint.settings`
 * and `endpoint.setIdentity` take their fields from the rows, and the daemon keeps the rest of a
 * setting (its file form, its checks and its effects) in a table of its own keyed the same way.
 */
interface SettingRow {
    /* The value as the machine holds it. */
    schema: z.ZodType;
    /* What a machine answers with while nobody changed it, and what an absent file field reads as. */
    default: unknown;
    /* The default is null and null goes on the wire, where otherwise it is left out. */
    nullable?: true;
    /* What a client sends when it differs from `schema`. */
    request?: z.ZodType;
    /* No request sets it. */
    settable?: false;
    /* Only the owner of the machine, the client that presented the local secret, may set it. */
    ownerOnly?: true;
    /* Only the owner is told: `endpoint.changed` leaves it out, and `endpoint.info` carries it to the owner alone. */
    ownerSees?: true;
}

const row = <const Row extends SettingRow>(spec: Row): Row => spec;

export const MACHINE_SETTINGS = {
    // Lets `view_delete` remove views an agent did not make. The daemon enforces it, so it lives in `endpoint.json`.
    agentsDeleteAnyView: row({ schema: z.boolean(), default: false }),
    // Lets an agent read the other projects open on this machine and start agents there (`--project`).
    reachOpenProjects: row({ schema: z.boolean(), default: false }),
    // Lets a message of an agent join a running turn, as a person's "Send to a working agent right away" does.
    steerMessages: row({ schema: z.boolean(), default: false }),
    // Browser pages and device screens.
    streamingAllowed: row({ schema: z.boolean(), default: true }),
    // Lets a chat that stopped on a limit resume on a clock when its own switch allows.
    resumeAtReset: row({ schema: z.boolean(), default: false }),
    // The `visual_*` tools. Off only when a person turned it off.
    visualReplies: row({ schema: z.boolean(), default: true }),
    // The model that writes new chat titles, commit messages and conflict proposals. Null is Automatic, and so is a pick that will not read.
    textModel: row({ schema: TextModelChoiceSchema, default: null, nullable: true, request: TextModelChoiceSchema.nullable() }),
    // The daemon holds the block, so it holds without a window and for a phone.
    keepAwake: row({ schema: KeepAwakeModeSchema, default: 'off' }),
    // Hold the block on battery as well; off, it holds on the power adapter only.
    keepAwakeOnBattery: row({ schema: z.boolean(), default: false }),
    // Keep the display on too, only under `always`.
    keepAwakeDisplay: row({ schema: z.boolean(), default: false }),
    // Turns sleep off (`pmset disablesleep`) while the block holds: on the adapter, or on battery above `CLOSED_LID_BATTERY_FLOOR` when
    // the block may hold there. Turning it on is refused with `closed-lid-no-rule` while the rule is not installed; off always goes through.
    keepAwakeLidClosed: row({ schema: z.boolean(), default: false }),
    // A person's pick, which a flag or the environment may still override.
    broker: row({ schema: BrokerSettingSchema, default: { mode: 'default' } }),
    // A client on the same network signals there before it tries the broker.
    lanDoor: row({ schema: z.boolean(), default: true }),
    // The folder new worktrees are made in; an empty string in a request puts it back to the data folder, which reads as null.
    worktreeRoot: row({
        schema: z.string(),
        default: null,
        nullable: true,
        request: z.string().max(4096),
        ownerOnly: true,
        ownerSees: true
    }),
    // The shell of a new terminal on Windows. Null reads as PowerShell and is left out.
    terminalShell: row({ schema: TerminalShellSchema, default: null, ownerOnly: true, ownerSees: true }),
    // Only the kinds a person changed; `endpoint.setNodeSize` sets them.
    nodeSizes: row({ schema: EndpointNodeSizesSchema, default: {}, settable: false }),
    // Anonymous daily usage counts sent from a release build. Whether this machine sends anything is the decision of the person who runs it.
    usageStats: row({ schema: z.boolean(), default: true, ownerOnly: true }),
    // Where browsing starts on this machine; empty is the home folder. A path means something on one machine only, so it lives here,
    // and `endpoint.setStartFolder` sets it for every client.
    startFolder: row({ schema: z.string().max(START_FOLDER_MAX), default: '', settable: false })
} as const;

type Rows = typeof MACHINE_SETTINGS;
export type MachineSettingKey = keyof Rows;

type ValueOf<Spec> = Spec extends { schema: infer Schema extends z.ZodType; default: infer Default }
    ? Default extends null
        ? z.infer<Schema> | null
        : z.infer<Schema>
    : never;

export type MachineSettingValues = { readonly [Key in MachineSettingKey]: ValueOf<Rows[Key]> };

type ReplyOf<Spec> = Spec extends { nullable: true; schema: infer Schema extends z.ZodType }
    ? z.ZodNullable<Schema>
    : Spec extends { schema: infer Schema extends z.ZodType }
      ? Schema
      : never;
type RequestOf<Spec> = Spec extends { request: infer Request extends z.ZodType }
    ? Request
    : Spec extends { schema: infer Schema extends z.ZodType }
      ? Schema
      : never;

type SettableKey = { [Key in MachineSettingKey]: Rows[Key] extends { settable: false } ? never : Key }[MachineSettingKey];
type EventKey = { [Key in MachineSettingKey]: Rows[Key] extends { ownerSees: true } ? never : Key }[MachineSettingKey];
type OwnerOnlyKey = { [Key in MachineSettingKey]: Rows[Key] extends { ownerOnly: true } ? Key : never }[MachineSettingKey];
type OwnerSeesKey = { [Key in MachineSettingKey]: Rows[Key] extends { ownerSees: true } ? Key : never }[MachineSettingKey];

export const MACHINE_SETTING_KEYS = Object.keys(MACHINE_SETTINGS) as readonly MachineSettingKey[];

/* The keys a request sets, in table order. */
export const SETTABLE_SETTING_KEYS = MACHINE_SETTING_KEYS.filter((key) => !('settable' in MACHINE_SETTINGS[key]));

export function settingDefault<Key extends MachineSettingKey>(key: Key): MachineSettingValues[Key] {
    return MACHINE_SETTINGS[key].default as MachineSettingValues[Key];
}

export function isOwnerOnlySetting(key: MachineSettingKey): key is OwnerOnlyKey {
    return 'ownerOnly' in MACHINE_SETTINGS[key];
}

/* Whether `endpoint.changed` leaves it out and `endpoint.info` tells only the owner. */
export function isOwnerSeenSetting(key: MachineSettingKey): key is OwnerSeesKey {
    return 'ownerSees' in MACHINE_SETTINGS[key];
}

/* Whether null goes on the wire for a setting that holds none, instead of the field being left out. */
export function settingSendsNull(key: MachineSettingKey): boolean {
    return 'nullable' in MACHINE_SETTINGS[key];
}

function shapeOf<Shape>(keys: readonly MachineSettingKey[], field: (key: MachineSettingKey) => z.ZodType): Shape {
    return Object.fromEntries(keys.map((key) => [key, field(key).optional()])) as Shape;
}

function replySchema(key: MachineSettingKey): z.ZodType {
    const spec: SettingRow = MACHINE_SETTINGS[key];

    return spec.nullable ? spec.schema.nullable() : spec.schema;
}

/* The fields of `endpoint.info`. */
export const ENDPOINT_INFO_SETTINGS = shapeOf<{ [Key in MachineSettingKey]: z.ZodOptional<ReplyOf<Rows[Key]>> }>(MACHINE_SETTING_KEYS, replySchema);

/* The fields of `endpoint.changed`, which every client hears. */
export const ENDPOINT_CHANGED_SETTINGS = shapeOf<{ [Key in EventKey]: z.ZodOptional<ReplyOf<Rows[Key]>> }>(
    MACHINE_SETTING_KEYS.filter((key) => !isOwnerSeenSetting(key)),
    replySchema
);

/* The fields of `endpoint.settings`: every one left out leaves the machine as it stands. */
export const ENDPOINT_REQUEST_SETTINGS = shapeOf<{ [Key in SettableKey]: z.ZodOptional<RequestOf<Rows[Key]>> }>(
    SETTABLE_SETTING_KEYS,
    (key) => (MACHINE_SETTINGS[key] as SettingRow).request ?? MACHINE_SETTINGS[key].schema
);
