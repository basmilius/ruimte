import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { isNotFound } from '@adecore/utils/errors';
import { writeAtomic } from '@adecore/utils/fs';
import {
    ProjectIconChoiceSchema,
    nodeSizeOf,
    type EndpointChangedEvent,
    type EndpointInfo,
    type EndpointNameSource,
    type KeepAwakeMode,
    type MachineSettingValues,
    type NodeKind,
    type NodeSize,
    type NodeSizes,
    type ProjectIconChoice
} from '@ruimte/contracts';
import { z } from 'zod';
import { generateKeyPair, signMessage } from './auth/keys.ts';
import { ClientSinks } from './client-sinks.ts';
import {
    SETTING_FILE_SHAPE,
    defaultSettings,
    followSettings,
    settingFields,
    settingsFromFile,
    settingsToFile,
    withSettings,
    type SettingDescription,
    type SettingPatch,
    type SettingPorts
} from './machine-settings.ts';
import type { SessionSink } from './wire.ts';

/*
 * The version stays at 1 on purpose as fields are added: zod strips what it does not know, so an older
 * daemon keeps its id. A bump would make it mint a new one, and every paired client would see a stranger.
 */
const FileSchema = z.object({
    version: z.literal(1),
    id: z.string().min(1),
    publicKey: z.string().min(1).optional(),
    privateKey: z.string().min(1).optional(),
    /* Absent while the machine answers to its default. A name or icon that will not read is dropped
       rather than refused: the id and key pair every client pinned are worth more than a name. */
    name: z.string().min(1).optional().catch(undefined),
    icon: ProjectIconChoiceSchema.optional().catch(undefined),
    ...SETTING_FILE_SHAPE
});

interface IdentityOptions {
    path: string;
    id: string;
    publicKey: string;
    privateKey: string;
    /* What the machine answers to until a person names it: `--label`, `RUIMTE_LABEL`, else the hostname. */
    defaultName: string;
    name: string | null;
    icon: ProjectIconChoice | null;
    settings: MachineSettingValues;
    ports: () => SettingPorts;
}

export interface KeepAwakeSetting {
    mode: KeepAwakeMode;
    onBattery: boolean;
    display: boolean;
    lidClosed: boolean;
}

/* Every setting of `MACHINE_SETTINGS` reads from the identity by its own name; the constructor defines them. */
const SettingReaders = class {} as unknown as new () => Readonly<MachineSettingValues>;

/*
 * The daemon's id and the key that proves it, minted once in `$RUIMTE_HOME`: a client keys what it
 * remembers on the id and pins the key, so only a new home is a new daemon. The name and icon a person
 * picked live here too, so every client of this machine sees the same ones, and so do the settings.
 */
export class EndpointIdentity extends SettingReaders {
    readonly id: string;
    readonly publicKey: string;
    private readonly path: string;
    private readonly privateKey: string;
    private readonly defaultName: string;
    private readonly sinks = new ClientSinks();
    private readonly ports: () => SettingPorts;
    private chosenName: string | null;
    private chosenIcon: ProjectIconChoice | null;
    private values: MachineSettingValues;

    constructor(options: IdentityOptions) {
        super();
        this.path = options.path;
        this.id = options.id;
        this.publicKey = options.publicKey;
        this.privateKey = options.privateKey;
        this.defaultName = options.defaultName;
        this.chosenName = options.name;
        this.chosenIcon = options.icon;
        this.values = options.settings;
        this.ports = options.ports;
        for (const key of Object.keys(this.values) as (keyof MachineSettingValues)[]) {
            Object.defineProperty(this, key, { get: () => this.values[key], enumerable: true });
        }
    }

    /* What clients call this machine: the name a person gave it, or the one it started with. */
    get label(): string {
        return this.chosenName ?? this.defaultName;
    }

    get nameSource(): EndpointNameSource {
        return this.chosenName === null ? 'default' : 'chosen';
    }

    get icon(): ProjectIconChoice | null {
        return this.chosenIcon;
    }

    get keepAwakeSetting(): KeepAwakeSetting {
        return {
            mode: this.values.keepAwake,
            onBattery: this.values.keepAwakeOnBattery,
            display: this.values.keepAwakeDisplay,
            lidClosed: this.values.keepAwakeLidClosed
        };
    }

    nodeSize(kind: NodeKind): NodeSize {
        return nodeSizeOf(this.values.nodeSizes, kind);
    }

    /* Null puts the kind back to its built-in size. Every client hears it, since every client adds nodes here. */
    async setNodeSize(kind: NodeKind, size: NodeSize | null): Promise<void> {
        const { [kind]: _replaced, ...others }: NodeSizes = this.values.nodeSizes;
        this.values = { ...this.values, nodeSizes: size === null ? others : { ...others, [kind]: { w: size.w, h: size.h } } };
        await this.persist();
        this.announce();
    }

    settings(): MachineSettingValues {
        return this.values;
    }

    /* Where the parts of the daemon stand, which every event carries. */
    describe(): SettingDescription {
        return this.ports().describe();
    }

    /* The settings only the owner of the machine is told. */
    ownerSettings(): Partial<EndpointInfo> {
        return settingFields(this.values, 'owner');
    }

    /* Signs a message with the daemon's private key; the private half never leaves this object. */
    sign(message: string): string {
        return signMessage(this.privateKey, message);
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        return this.sinks.subscribe(clientId, sink);
    }

    /*
     * A null name hands the machine back to the one it starts with; a null icon leaves it without
     * one. A setting not passed stays as it stands, since naming a machine is a control of its own.
     */
    async setIdentity(name: string | null, icon: ProjectIconChoice | null, patch: SettingPatch = {}): Promise<void> {
        const before = this.values;
        this.chosenName = name;
        this.chosenIcon = icon;
        this.values = withSettings(before, patch);
        await this.persist();
        await followSettings(before, this.values, this.ports);
        this.announce();
    }

    setSwitches(patch: SettingPatch): Promise<void> {
        return this.setIdentity(this.chosenName, this.chosenIcon, patch);
    }

    /* What `endpoint.changed` says, and the part of `endpoint.info` that does not depend on who asks. */
    snapshot(): EndpointChangedEvent {
        return {
            id: this.id,
            label: this.label,
            nameSource: this.nameSource,
            icon: this.chosenIcon,
            ...settingFields(this.values, 'everyone'),
            ...this.ports().describe()
        } as EndpointChangedEvent;
    }

    /* Also called after a change in something the event describes. */
    announce(): void {
        this.sinks.emit({ event: 'endpoint.changed', payload: this.snapshot() });
    }

    /* Writes the file as this object stands; a fresh home is written the moment it is minted. */
    async persist(): Promise<void> {
        const file = {
            version: 1,
            id: this.id,
            publicKey: this.publicKey,
            privateKey: this.privateKey,
            ...(this.chosenName === null ? {} : { name: this.chosenName }),
            ...(this.chosenIcon === null ? {} : { icon: this.chosenIcon }),
            ...settingsToFile(this.values)
        };
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        // Durable: a power cut right after a change must not leave an empty file where the key pair was.
        await writeAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`, 0o600, { durable: true });
    }
}

function parseEndpointFile(text: string): z.infer<typeof FileSchema> | null {
    try {
        const parsed = FileSchema.safeParse(JSON.parse(text));
        return parsed.success ? parsed.data : null;
    } catch {
        return null;
    }
}

/*
 * The file as it stands, or null when there is none yet. One that will not read is set aside before
 * anything is minted, so the key pair every paired client pinned can still be put back by hand.
 */
async function readEndpointFile(path: string): Promise<z.infer<typeof FileSchema> | null> {
    let text: string;
    try {
        text = await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return null;
        }
        throw e;
    }
    const file = parseEndpointFile(text);
    if (file === null) {
        const setAside = `${path}.corrupt-${new Date().toISOString().replace(/[:.]/g, '-')}`;
        await rename(path, setAside);
        console.warn(`${path} would not read; it is kept as ${setAside} and this machine starts with a new id`);
    }
    return file;
}

/* A daemon that has not handed its parts over yet cannot follow a change or describe itself. */
function portsNotHandedOver(): SettingPorts {
    throw new Error('The settings of the machine identity were used before the daemon handed over its parts');
}

/*
 * Reads `$RUIMTE_HOME/endpoint.json` and mints whatever is not in it yet. `ports` is read when a setting
 * changes or an event describes the machine, which the daemon wires after the identity.
 */
export async function readOrCreateEndpointIdentity(
    home: string,
    defaultName: string = hostname(),
    ports: () => SettingPorts = portsNotHandedOver
): Promise<EndpointIdentity> {
    const path = join(home, 'endpoint.json');
    const file = await readEndpointFile(path);
    const keys = file?.publicKey && file.privateKey ? { publicKey: file.publicKey, privateKey: file.privateKey } : null;
    const identity = new EndpointIdentity({
        path,
        // A home that already has an id keeps it and only gains a key pair; losing the id would unpair every client.
        id: file?.id ?? randomBytes(8).toString('base64url'),
        ...(keys ?? generateKeyPair()),
        defaultName,
        name: file?.name ?? null,
        icon: file?.icon ?? null,
        settings: file === null ? defaultSettings() : settingsFromFile(file),
        ports
    });
    if (!keys) {
        await identity.persist();
    }
    return identity;
}
