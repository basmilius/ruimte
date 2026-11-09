import { CodedError } from '@adecore/agents';
import {
    MACHINE_SETTINGS,
    MACHINE_SETTING_KEYS,
    SETTABLE_SETTING_KEYS,
    isOwnerOnlySetting,
    isOwnerSeenSetting,
    knownNodeSizes,
    settingDefault,
    settingSendsNull,
    type AgentIntegrationsSummary,
    type EndpointInfo,
    type EndpointSettings,
    type MachineSettingKey,
    type MachineSettingValues,
    type TextModelChoice
} from '@ruimte/contracts';
import type { LanDoor } from '@ruimte/pulsar';
import { z } from 'zod';
import { checkWorktreeRoot } from './git/worktree-root.ts';

/* A change to some of the settings; one left out stays as it stands. */
export type SettingPatch = { readonly [Key in MachineSettingKey]?: MachineSettingValues[Key] };

/* The fields of `endpoint.changed` that come from the parts of the daemon and not from a setting. */
export interface SettingDescription {
    keepAwakeLidRule: boolean;
    agentIntegrations: AgentIntegrationsSummary;
    brokerUrl: string | null;
    brokerFixed: boolean;
    lan: LanDoor | null;
    lanDoorFixed: boolean;
}

/* What the daemon lends its settings, made after the identity that holds them: how to follow a change, and where the parts stand. */
export interface SettingPorts {
    describe(): SettingDescription;
    keepAwakeChanged(): void;
    streamingChanged(allowed: boolean): void;
    resumeChanged(on: boolean): void;
    usageStatsChanged(on: boolean): Promise<void>;
    brokerChanged(): Promise<void>;
    lanDoorChanged(): void;
}

/* What a request is checked against. */
export interface SettingContext {
    /* The client presented the local secret. */
    owner: boolean;
    /* `$RUIMTE_HOME`, which a worktree folder may not sit in. */
    home: string;
    closedLid: { available: boolean; rule(): Promise<boolean> };
    current: MachineSettingValues;
    /* Throws when the machine cannot write short texts with this pick: its CLI, model or account is not there. */
    validateTextModel(choice: TextModelChoice): Promise<void>;
}

type Effect = (values: MachineSettingValues, ports: SettingPorts) => void | Promise<void>;

type RequestOf<Key extends MachineSettingKey> = Key extends keyof EndpointSettings ? Exclude<EndpointSettings[Key], undefined> : never;

/* The daemon's side of a row of `MACHINE_SETTINGS`: how it is kept in the file, checked in a request and followed once it changed. */
interface ServerRow<Key extends MachineSettingKey> {
    /* The schema of the field in `endpoint.json`, where it differs from the value's. */
    file?: z.ZodType;
    /* Reads the field of the file, which is absent or whatever the file held. */
    fromFile?(raw: unknown): MachineSettingValues[Key];
    /* What a refused client is told it cannot do. */
    ownerAction?: string;
    /* Checks what a client sent and turns it into the value to keep; throws a `CodedError` to refuse. */
    prepare?(request: RequestOf<Key>, context: SettingContext): MachineSettingValues[Key] | Promise<MachineSettingValues[Key]>;
    /* Follows a change once it is kept. A row that shares a function with another runs it once per change. */
    changed?: Effect;
}

const keepAwakeChanged: Effect = (_values, ports) => ports.keepAwakeChanged();

const SERVER_ROWS: { readonly [Key in MachineSettingKey]?: ServerRow<Key> } = {
    streamingAllowed: { changed: (values, ports) => ports.streamingChanged(values.streamingAllowed) },
    agentsSharePorts: { ownerAction: 'let agents share ports' },
    resumeAtReset: { changed: (values, ports) => ports.resumeChanged(values.resumeAtReset) },
    // A pick this machine cannot use now is refused here, so a person hears why while choosing and not on the first commit message.
    textModel: {
        async prepare(request, context) {
            if (request !== null) {
                await context.validateTextModel(request);
            }

            return request;
        }
    },
    keepAwake: { changed: keepAwakeChanged },
    keepAwakeOnBattery: { changed: keepAwakeChanged },
    keepAwakeDisplay: { changed: keepAwakeChanged },
    keepAwakeLidClosed: {
        // Off always goes through, and a switch already on stays on; only turning it on needs the rule.
        async prepare(request, context) {
            if (request && !context.current.keepAwakeLidClosed) {
                if (!context.closedLid.available) {
                    throw new CodedError('closed-lid-unavailable', 'Only a Mac can stay awake with its lid closed');
                }
                if (!(await context.closedLid.rule())) {
                    throw new CodedError('closed-lid-no-rule', 'Allow it on the Mac first: Ruimte there installs the rule with an administrator password');
                }
            }

            return request;
        },
        changed: keepAwakeChanged
    },
    broker: { changed: (_values, ports) => ports.brokerChanged() },
    lanDoor: { changed: (_values, ports) => ports.lanDoorChanged() },
    worktreeRoot: {
        file: z.string().min(1),
        ownerAction: 'choose where it makes worktrees',
        // Where checkouts land decides which folders the daemon makes and writes in.
        async prepare(request, context) {
            if (request === '') {
                return null;
            }
            const checked = await checkWorktreeRoot(request, context.home);
            if ('refusal' in checked) {
                throw new CodedError(checked.refusal, checked.message);
            }

            return checked.root;
        }
    },
    terminalShell: { ownerAction: 'choose the shell of its terminals' },
    // Read one kind at a time, so a size that will not read costs that kind alone.
    nodeSizes: { file: z.unknown(), fromFile: knownNodeSizes },
    usageStats: {
        ownerAction: 'turn its usage statistics on or off',
        changed: (values, ports) => ports.usageStatsChanged(values.usageStats)
    }
};

function serverRow(key: MachineSettingKey): ServerRow<MachineSettingKey> {
    return (SERVER_ROWS as Partial<Record<MachineSettingKey, ServerRow<MachineSettingKey>>>)[key] ?? {};
}

function same(left: unknown, right: unknown): boolean {
    return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function defaultSettings(): MachineSettingValues {
    return Object.fromEntries(MACHINE_SETTING_KEYS.map((key) => [key, settingDefault(key)])) as MachineSettingValues;
}

/* The settings of `endpoint.json`. A field that will not read is dropped, and the setting reads as its default. */
export const SETTING_FILE_SHAPE = Object.fromEntries(
    MACHINE_SETTING_KEYS.map((key) => [key, (serverRow(key).file ?? MACHINE_SETTINGS[key].schema).optional().catch(undefined)])
) as Record<string, z.ZodType>;

export function settingsFromFile(file: Readonly<Record<string, unknown>>): MachineSettingValues {
    return Object.fromEntries(
        MACHINE_SETTING_KEYS.map((key) => {
            const read = serverRow(key).fromFile;
            const raw = file[key];

            return [key, read ? read(raw) : (raw ?? settingDefault(key))];
        })
    ) as MachineSettingValues;
}

/* Only a setting away from its default is written, so a file stays as short as what a person changed. */
export function settingsToFile(values: MachineSettingValues): Record<string, unknown> {
    return Object.fromEntries(MACHINE_SETTING_KEYS.filter((key) => !same(values[key], settingDefault(key))).map((key) => [key, values[key]]));
}

export function withSettings(values: MachineSettingValues, patch: SettingPatch): MachineSettingValues {
    const changes = Object.entries(patch).filter(([, value]) => value !== undefined);

    return { ...values, ...Object.fromEntries(changes) };
}

/* The settings as a client reads them: those every client hears, or those only the owner is told. Null is left out where the wire has no null. */
export function settingFields(values: MachineSettingValues, audience: 'everyone' | 'owner'): Partial<EndpointInfo> {
    const keys = MACHINE_SETTING_KEYS.filter((key) => isOwnerSeenSetting(key) === (audience === 'owner') && (values[key] !== null || settingSendsNull(key)));

    return Object.fromEntries(keys.map((key) => [key, values[key]])) as Partial<EndpointInfo>;
}

/* Refuses what the client may not set or what does not hold, and returns what to keep. */
export async function prepareSettings(request: EndpointSettings, context: SettingContext): Promise<SettingPatch> {
    const asked = SETTABLE_SETTING_KEYS.filter((key) => request[key as keyof EndpointSettings] !== undefined);
    for (const key of asked) {
        if (isOwnerOnlySetting(key) && !context.owner) {
            throw new CodedError('owner-only', `Only a person on this machine can ${serverRow(key).ownerAction ?? 'change that'}`);
        }
    }
    const patch: Record<string, unknown> = {};
    for (const key of asked) {
        const value = request[key as keyof EndpointSettings];
        const prepare = serverRow(key).prepare as ((request: unknown, context: SettingContext) => unknown) | undefined;
        patch[key] = prepare ? await prepare(value, context) : value;
    }

    return patch as SettingPatch;
}

/* Follows each setting that changed, once per effect, in the order of the table. */
export async function followSettings(before: MachineSettingValues, after: MachineSettingValues, ports: () => SettingPorts): Promise<void> {
    const effects = new Set<Effect>();
    for (const key of MACHINE_SETTING_KEYS) {
        const changed = serverRow(key).changed;
        if (changed !== undefined && !same(before[key], after[key])) {
            effects.add(changed);
        }
    }
    for (const effect of effects) {
        await effect(after, ports());
    }
}
