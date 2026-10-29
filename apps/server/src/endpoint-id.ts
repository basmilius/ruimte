import { randomBytes } from 'node:crypto';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import {
    KeepAwakeModeSchema,
    ProjectIconChoiceSchema,
    knownNodeSizes,
    nodeSizeOf,
    type EndpointNameSource,
    type NodeKind,
    type NodeSize,
    type NodeSizes,
    type KeepAwakeMode,
    type AgentIntegrationsSummary,
    type LanDoor,
    type ProjectIconChoice
} from '@ruimte/contracts';
import { BrokerSettingSchema, type BrokerSetting } from '@ruimte/pulsar';
import { z } from 'zod';
import { generateKeyPair, signMessage } from './auth/keys.ts';
import { isNotFound, writeAtomic } from '@adecore/agents';
import type { SessionSink } from './sessions/manager.ts';
import { ClientSinks } from './client-sinks.ts';
import { Binding } from './binding.ts';

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
    /* Whether an agent's `view delete` may remove any view here, not only the ones it made. A machine
       setting because the daemon enforces it. Absent is off. */
    agentsDeleteAnyView: z.boolean().optional().catch(undefined),
    /* Whether an agent may reach the other projects open here with `--project`. A machine setting because
       the daemon enforces it. Absent is off. */
    reachOpenProjects: z.boolean().optional().catch(undefined),
    /* Whether clients may stream browser pages and device screens. Absent is on. */
    streamingAllowed: z.boolean().optional().catch(undefined),
    /* Whether a chat stopped on a limit may resume on a clock when its own switch lets it. The daemon
       keeps that clock, so the switch is the machine's. Absent is off. */
    resumeAtReset: z.boolean().optional().catch(undefined),
    /* Whether an agent in an AI chat may show a page above its reply. Absent is on. */
    visualReplies: z.boolean().optional().catch(undefined),
    appleFoundationEnabled: z.boolean().optional().catch(undefined),
    /* The daemon holds the sleep block, so a phone can set it. Absent is off, on the adapter only and
       without the display. */
    keepAwake: KeepAwakeModeSchema.optional().catch(undefined),
    keepAwakeOnBattery: z.boolean().optional().catch(undefined),
    keepAwakeDisplay: z.boolean().optional().catch(undefined),
    // Does nothing until the sudoers rule is installed. Absent is off.
    keepAwakeLidClosed: z.boolean().optional().catch(undefined),
    /* Absent is the build's default, and one that will not read falls back to it, since a machine on
       the default broker is findable. */
    broker: BrokerSettingSchema.optional().catch(undefined),
    /* Whether a client on the same network signals without the broker. Absent is open. */
    lanDoor: z.boolean().optional().catch(undefined),
    /* Absent is `worktrees` in the data folder. */
    worktreeRoot: z.string().min(1).optional().catch(undefined),
    /* Only the kinds a person changed, read one kind at a time (`knownNodeSizes`) so a size that will
       not read costs that kind alone. */
    nodeSizes: z.unknown().optional(),
    /* Whether a release build sends its anonymous daily usage counts. Absent is on. */
    usageStats: z.boolean().optional().catch(undefined)
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
    agentsDeleteAnyView: boolean;
    reachOpenProjects: boolean;
    streamingAllowed: boolean;
    resumeAtReset: boolean;
    visualReplies: boolean;
    appleFoundationEnabled: boolean;
    keepAwake: KeepAwakeSetting;
    broker: BrokerSetting;
    lanDoor: boolean;
    worktreeRoot: string | null;
    nodeSizes: NodeSizes;
    usageStats: boolean;
}

export interface KeepAwakeSetting {
    mode: KeepAwakeMode;
    onBattery: boolean;
    display: boolean;
    lidClosed: boolean;
}

/* What the daemon's broker switch lends the identity: a way to follow a new setting and to say where it ended up. */
interface IdentityBroker {
    apply(): Promise<void>;
    describe(): { brokerUrl: string | null; brokerFixed: boolean };
}

/* What the daemon's door on the local network lends the identity: a way to follow a new setting and to say where the door stands. */
export interface IdentityLanDoor {
    apply(): void;
    describe(): { lan: LanDoor | null; lanDoorFixed: boolean };
}

/* What the closed lid lends the identity: whether its rule is installed, which every event carries. */
interface IdentityClosedLid {
    describe(): { keepAwakeLidRule: boolean };
}

/* What the consent for the CLIs' global settings lends the identity: where it stands, which every event carries. */
interface IdentityAgentIntegrations {
    describe(): { agentIntegrations: AgentIntegrationsSummary };
}

/* The switches a client sets on the machine; one left out stays as it stands. */
export interface IdentityFlags {
    agentsDeleteAnyView?: boolean;
    reachOpenProjects?: boolean;
    streamingAllowed?: boolean;
    resumeAtReset?: boolean;
    visualReplies?: boolean;
    appleFoundationEnabled?: boolean;
    keepAwake?: KeepAwakeMode;
    keepAwakeOnBattery?: boolean;
    keepAwakeDisplay?: boolean;
    keepAwakeLidClosed?: boolean;
    broker?: BrokerSetting;
    lanDoor?: boolean;
    // An empty string puts it back to the data folder.
    worktreeRoot?: string;
    usageStats?: boolean;
}

/*
 * The daemon's id and the key that proves it, minted once in `$RUIMTE_HOME`: a client keys what it
 * remembers on the id and pins the key, so only a new home is a new daemon. The name and icon a person
 * picked live here too, so every client of this machine sees the same ones.
 */
export class EndpointIdentity {
    readonly id: string;
    readonly publicKey: string;
    private readonly path: string;
    private readonly privateKey: string;
    private readonly defaultName: string;
    private readonly sinks = new ClientSinks();
    private chosenName: string | null;
    private chosenIcon: ProjectIconChoice | null;
    private deleteAnyView: boolean;
    private reachOpen: boolean;
    private allowStreaming: boolean;
    private resumeLimited: boolean;
    private visuals: boolean;
    private appleEnabled: boolean;
    private awake: KeepAwakeSetting;
    private brokerSetting: BrokerSetting;
    private readonly brokerSwitch = new Binding<IdentityBroker>('The broker switch of the machine identity');
    private lanDoorOpen: boolean;
    private checkoutRoot: string | null;
    private sizes: NodeSizes;
    private stats: boolean;
    private readonly door = new Binding<IdentityLanDoor>('The door on the local network of the machine identity');
    private readonly closedLid = new Binding<IdentityClosedLid>('The closed-lid rule of the machine identity');
    private readonly integrations = new Binding<IdentityAgentIntegrations>('The agent integrations of the machine identity');

    constructor(options: IdentityOptions) {
        this.path = options.path;
        this.id = options.id;
        this.publicKey = options.publicKey;
        this.privateKey = options.privateKey;
        this.defaultName = options.defaultName;
        this.chosenName = options.name;
        this.chosenIcon = options.icon;
        this.deleteAnyView = options.agentsDeleteAnyView;
        this.reachOpen = options.reachOpenProjects;
        this.allowStreaming = options.streamingAllowed;
        this.resumeLimited = options.resumeAtReset;
        this.visuals = options.visualReplies;
        this.appleEnabled = options.appleFoundationEnabled;
        this.awake = options.keepAwake;
        this.brokerSetting = options.broker;
        this.lanDoorOpen = options.lanDoor;
        this.checkoutRoot = options.worktreeRoot;
        this.sizes = options.nodeSizes;
        this.stats = options.usageStats;
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

    get agentsDeleteAnyView(): boolean {
        return this.deleteAnyView;
    }

    /* Read at every call across projects, so turning it off refuses the next one. */
    get reachOpenProjects(): boolean {
        return this.reachOpen;
    }

    get streamingAllowed(): boolean {
        return this.allowStreaming;
    }

    /* Each chat can still say no. */
    get resumeAtReset(): boolean {
        return this.resumeLimited;
    }

    /* Whether `ruimte-context visual show` publishes; pages already in a thread show either way. */
    get visualReplies(): boolean {
        return this.visuals;
    }

    get appleFoundationEnabled(): boolean {
        return this.appleEnabled;
    }

    get keepAwake(): KeepAwakeSetting {
        return this.awake;
    }

    /* The setting as `endpoint.info` and `endpoint.changed` spell it. */
    keepAwakeFields(): { keepAwake: KeepAwakeMode; keepAwakeOnBattery: boolean; keepAwakeDisplay: boolean; keepAwakeLidClosed: boolean } {
        return {
            keepAwake: this.awake.mode,
            keepAwakeOnBattery: this.awake.onBattery,
            keepAwakeDisplay: this.awake.display,
            keepAwakeLidClosed: this.awake.lidClosed
        };
    }

    /* Lets every event say whether the closed-lid rule is installed. */
    attachClosedLid(closedLid: IdentityClosedLid): void {
        this.closedLid.bind(closedLid);
    }

    /* Lets every event say what a person allowed in the CLIs' global settings. */
    attachAgentIntegrations(integrations: IdentityAgentIntegrations): void {
        this.integrations.bind(integrations);
    }

    /* The broker a person picked for this machine, which a flag or the environment may still override. */
    get broker(): BrokerSetting {
        return this.brokerSetting;
    }

    /* Hands a changed broker setting to the switch that runs the relay, and lets the event say what it became. */
    attachBroker(broker: IdentityBroker): void {
        this.brokerSwitch.bind(broker);
    }

    /* `--no-lan` may still override it. */
    get lanDoor(): boolean {
        return this.lanDoorOpen;
    }

    /* Null while new worktrees go in the data folder. */
    get worktreeRoot(): string | null {
        return this.checkoutRoot;
    }

    get usageStats(): boolean {
        return this.stats;
    }

    /* Only the kinds a person changed; `nodeSize` answers for every kind. */
    get nodeSizes(): NodeSizes {
        return this.sizes;
    }

    nodeSize(kind: NodeKind): NodeSize {
        return nodeSizeOf(this.sizes, kind);
    }

    /* Null puts the kind back to its built-in size. Every client hears it, since every client adds nodes here. */
    async setNodeSize(kind: NodeKind, size: NodeSize | null): Promise<void> {
        const { [kind]: _replaced, ...others } = this.sizes;
        this.sizes = size === null ? others : { ...others, [kind]: { w: size.w, h: size.h } };
        await this.persist();
        this.announce();
    }

    /* Hands a changed door setting to the door, and lets the event say where it stands. */
    attachLanDoor(door: IdentityLanDoor): void {
        this.door.bind(door);
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
     * one. A switch not passed stays as it stands, since naming a machine is a control of its own.
     */
    async setIdentity(name: string | null, icon: ProjectIconChoice | null, flags: IdentityFlags = {}): Promise<void> {
        this.chosenName = name;
        this.chosenIcon = icon;
        this.deleteAnyView = flags.agentsDeleteAnyView ?? this.deleteAnyView;
        this.reachOpen = flags.reachOpenProjects ?? this.reachOpen;
        this.allowStreaming = flags.streamingAllowed ?? this.allowStreaming;
        this.resumeLimited = flags.resumeAtReset ?? this.resumeLimited;
        this.visuals = flags.visualReplies ?? this.visuals;
        this.appleEnabled = flags.appleFoundationEnabled ?? this.appleEnabled;
        this.awake = {
            mode: flags.keepAwake ?? this.awake.mode,
            onBattery: flags.keepAwakeOnBattery ?? this.awake.onBattery,
            display: flags.keepAwakeDisplay ?? this.awake.display,
            lidClosed: flags.keepAwakeLidClosed ?? this.awake.lidClosed
        };
        this.brokerSetting = flags.broker ?? this.brokerSetting;
        this.lanDoorOpen = flags.lanDoor ?? this.lanDoorOpen;
        this.stats = flags.usageStats ?? this.stats;
        if (flags.worktreeRoot !== undefined) {
            this.checkoutRoot = flags.worktreeRoot === '' ? null : flags.worktreeRoot;
        }
        await this.persist();
        if (flags.broker !== undefined) {
            await this.brokerSwitch.get().apply();
        }
        if (flags.lanDoor !== undefined) {
            this.door.get().apply();
        }
        this.announce();
    }

    setSwitches(flags: IdentityFlags): Promise<void> {
        return this.setIdentity(this.chosenName, this.chosenIcon, flags);
    }

    /* Also called after a change in something the event describes. */
    announce(): void {
        this.sinks.emit({
            event: 'endpoint.changed',
            payload: {
                id: this.id,
                label: this.label,
                nameSource: this.nameSource,
                icon: this.chosenIcon,
                agentsDeleteAnyView: this.deleteAnyView,
                reachOpenProjects: this.reachOpen,
                streamingAllowed: this.allowStreaming,
                resumeAtReset: this.resumeLimited,
                visualReplies: this.visuals,
                appleFoundationEnabled: this.appleEnabled,
                ...this.keepAwakeFields(),
                ...this.closedLid.get().describe(),
                ...this.integrations.get().describe(),
                broker: this.brokerSetting,
                ...this.brokerSwitch.get().describe(),
                lanDoor: this.lanDoorOpen,
                ...this.door.get().describe(),
                nodeSizes: this.sizes,
                usageStats: this.stats
            }
        });
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
            ...(this.deleteAnyView ? { agentsDeleteAnyView: true } : {}),
            ...(this.reachOpen ? { reachOpenProjects: true } : {}),
            ...(!this.allowStreaming ? { streamingAllowed: false } : {}),
            ...(this.resumeLimited ? { resumeAtReset: true } : {}),
            ...(this.visuals ? {} : { visualReplies: false }),
            ...(this.appleEnabled ? { appleFoundationEnabled: true } : {}),
            ...(this.awake.mode === 'off' ? {} : { keepAwake: this.awake.mode }),
            ...(this.awake.onBattery ? { keepAwakeOnBattery: true } : {}),
            ...(this.awake.display ? { keepAwakeDisplay: true } : {}),
            ...(this.awake.lidClosed ? { keepAwakeLidClosed: true } : {}),
            ...(this.brokerSetting.mode === 'default' ? {} : { broker: this.brokerSetting }),
            ...(this.lanDoorOpen ? {} : { lanDoor: false }),
            ...(this.checkoutRoot === null ? {} : { worktreeRoot: this.checkoutRoot }),
            ...(Object.keys(this.sizes).length === 0 ? {} : { nodeSizes: this.sizes }),
            ...(this.stats ? {} : { usageStats: false })
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

/* Reads `$RUIMTE_HOME/endpoint.json` and mints whatever is not in it yet. */
export async function readOrCreateEndpointIdentity(home: string, defaultName: string = hostname()): Promise<EndpointIdentity> {
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
        agentsDeleteAnyView: file?.agentsDeleteAnyView ?? false,
        reachOpenProjects: file?.reachOpenProjects ?? false,
        streamingAllowed: file?.streamingAllowed ?? true,
        resumeAtReset: file?.resumeAtReset ?? false,
        visualReplies: file?.visualReplies ?? true,
        appleFoundationEnabled: file?.appleFoundationEnabled ?? false,
        keepAwake: {
            mode: file?.keepAwake ?? 'off',
            onBattery: file?.keepAwakeOnBattery ?? false,
            display: file?.keepAwakeDisplay ?? false,
            lidClosed: file?.keepAwakeLidClosed ?? false
        },
        broker: file?.broker ?? { mode: 'default' },
        lanDoor: file?.lanDoor ?? true,
        worktreeRoot: file?.worktreeRoot ?? null,
        nodeSizes: knownNodeSizes(file?.nodeSizes),
        usageStats: file?.usageStats ?? true
    });
    if (!keys) {
        await identity.persist();
    }
    return identity;
}
