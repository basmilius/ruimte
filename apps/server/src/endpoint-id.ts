import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectIconChoiceSchema, type EndpointNameSource, type ProjectIconChoice } from '@ruimte/contracts';
import { BrokerSettingSchema, type BrokerSetting } from '@ruimte/pulsar';
import { z } from 'zod';
import { generateKeyPair, signMessage } from './auth/keys.ts';
import { isNotFound, writeAtomic } from './fs.ts';
import type { SessionEvent, SessionSink } from './sessions/manager.ts';
import { errorText } from './error-text.ts';
import { ClientSinks } from './client-sinks.ts';

/*
 * The key pair arrived after the id did, and the name and icon after the keys; the version stays at
 * 1 on purpose: zod strips what it does not know, so a daemon from before any of them reads this
 * file, keeps its id and leaves the extra fields alone. Bumping the version would make that daemon
 * mint a new id, and every paired client would see the machine it knows answer as a stranger.
 */
const FileSchema = z.object({
    version: z.literal(1),
    id: z.string().min(1),
    publicKey: z.string().min(1).optional(),
    privateKey: z.string().min(1).optional(),
    /* What a person called this machine from a client; absent while it still answers to its default.
       Both are dropped rather than refused when they will not read: an id and a key pair every
       client pairs on are worth more than a name, which a person can simply type again. */
    name: z.string().min(1).optional().catch(undefined),
    icon: ProjectIconChoiceSchema.optional().catch(undefined),
    /* Whether an agent's `view delete` may remove any view of a project on this machine instead of
       only the ones it made. It is here rather than in a client's settings because the daemon is
       what enforces it, and a client setting would hold nothing back. Absent is off. */
    agentsDeleteAnyView: z.boolean().optional().catch(undefined),
    /* Whether a statement from the address book is turned away, which leaves a pairing link as the only
       way in. Here for the same reason as the switch above: the daemon is what takes a statement or
       does not. Absent is off, which is what "logging in grants access" means. */
    refuseStatements: z.boolean().optional().catch(undefined),
    /* Whether clients may stream browser pages and, later, device screens from this daemon. Absent
       is on so existing machines keep the behavior they had before this switch existed. */
    streamingAllowed: z.boolean().optional().catch(undefined),
    /* Whether a chat that stopped on a limit may be taken up again on a clock, at the reset or after an
       overload, when its own switch lets it. The daemon keeps that clock, so the switch is the machine's.
       Absent is off. */
    resumeAtReset: z.boolean().optional().catch(undefined),
    /* Which broker this machine announces itself to, set from a client. Absent is the build's default;
       one that will not read falls back to it too, since a machine on the default broker is findable. */
    broker: BrokerSettingSchema.optional().catch(undefined)
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
    refuseStatements: boolean;
    streamingAllowed: boolean;
    resumeAtReset: boolean;
    broker: BrokerSetting;
}

/* What the daemon's broker switch lends the identity: a way to follow a new setting and to say where it ended up. */
export interface IdentityBroker {
    apply(): Promise<void>;
    describe(): { brokerUrl: string | null; brokerFixed: boolean };
}

/* The switches a client sets on the machine; one left out stays as it stands. */
export interface IdentityFlags {
    agentsDeleteAnyView?: boolean;
    refuseStatements?: boolean;
    streamingAllowed?: boolean;
    resumeAtReset?: boolean;
    broker?: BrokerSetting;
}

/*
 * The daemon's own name for itself and the key that proves it, minted once and kept in
 * `$RUIMTE_HOME`. A client keys everything it remembers about a machine on the id and pins the
 * public key at pairing, so both have to survive a restart and a new address; only a new home is a
 * new daemon. The name and the icon a person picked live here too, rather than in one client's
 * storage, because every client paired with this machine has to see the same ones.
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
    private noStatements: boolean;
    private allowStreaming: boolean;
    private resumeLimited: boolean;
    private brokerSetting: BrokerSetting;
    private brokerSwitch: IdentityBroker | null = null;

    constructor(options: IdentityOptions) {
        this.path = options.path;
        this.id = options.id;
        this.publicKey = options.publicKey;
        this.privateKey = options.privateKey;
        this.defaultName = options.defaultName;
        this.chosenName = options.name;
        this.chosenIcon = options.icon;
        this.deleteAnyView = options.agentsDeleteAnyView;
        this.noStatements = options.refuseStatements;
        this.allowStreaming = options.streamingAllowed;
        this.resumeLimited = options.resumeAtReset;
        this.brokerSetting = options.broker;
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

    /* What a canvas verb asks before it removes a view somebody else made. Off on a fresh machine:
       an agent destroys only what it made until a person says otherwise. */
    get agentsDeleteAnyView(): boolean {
        return this.deleteAnyView;
    }

    /* What an offer carrying a statement is asked about. Off on a fresh machine. */
    get refuseStatements(): boolean {
        return this.noStatements;
    }

    /* The daemon checks this at the streaming boundary; native views on a client do not need it. */
    get streamingAllowed(): boolean {
        return this.allowStreaming;
    }

    /* Whether the outbox may take up a limited chat on a clock; off on a fresh machine, and each chat can still say no. */
    get resumeAtReset(): boolean {
        return this.resumeLimited;
    }

    /* The broker a person picked for this machine, which a flag or the environment may still override. */
    get broker(): BrokerSetting {
        return this.brokerSetting;
    }

    /* Hands a changed broker setting to the switch that runs the relay, and lets the event say what it became. */
    attachBroker(broker: IdentityBroker): void {
        this.brokerSwitch = broker;
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
     * one. A switch is left as it stands when it is not passed, since the dialog that names a machine
     * is not the control that sets it.
     */
    async setIdentity(name: string | null, icon: ProjectIconChoice | null, flags: IdentityFlags = {}): Promise<void> {
        this.chosenName = name;
        this.chosenIcon = icon;
        this.deleteAnyView = flags.agentsDeleteAnyView ?? this.deleteAnyView;
        this.noStatements = flags.refuseStatements ?? this.noStatements;
        this.allowStreaming = flags.streamingAllowed ?? this.allowStreaming;
        this.resumeLimited = flags.resumeAtReset ?? this.resumeLimited;
        this.brokerSetting = flags.broker ?? this.brokerSetting;
        await this.persist();
        if (flags.broker !== undefined) {
            await this.brokerSwitch?.apply();
        }
        const event: SessionEvent = {
            event: 'endpoint.changed',
            payload: {
                id: this.id,
                label: this.label,
                nameSource: this.nameSource,
                icon: this.chosenIcon,
                agentsDeleteAnyView: this.deleteAnyView,
                refuseStatements: this.noStatements,
                streamingAllowed: this.allowStreaming,
                resumeAtReset: this.resumeLimited,
                broker: this.brokerSetting,
                ...this.brokerSwitch?.describe()
            }
        };
        this.sinks.emit(event);
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
            ...(this.noStatements ? { refuseStatements: true } : {}),
            ...(!this.allowStreaming ? { streamingAllowed: false } : {}),
            ...(this.resumeLimited ? { resumeAtReset: true } : {}),
            ...(this.brokerSetting.mode === 'default' ? {} : { broker: this.brokerSetting })
        };
        await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
        await writeAtomic(this.path, `${JSON.stringify(file, null, 2)}\n`, 0o600);
    }
}

/* Reads `$RUIMTE_HOME/endpoint.json` and mints whatever is not in it yet. */
export const readOrCreateEndpointIdentity = async (home: string, defaultName: string = hostname()): Promise<EndpointIdentity> => {
    const path = join(home, 'endpoint.json');
    let file: z.infer<typeof FileSchema> | null = null;
    try {
        const parsed = FileSchema.safeParse(JSON.parse(await readFile(path, 'utf8')));
        if (parsed.success) {
            file = parsed.data;
        }
    } catch (e) {
        if (!isNotFound(e)) {
            console.warn('The endpoint id file would not parse; minting a new id:', errorText(e));
        }
    }
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
        refuseStatements: file?.refuseStatements ?? false,
        streamingAllowed: file?.streamingAllowed ?? true,
        resumeAtReset: file?.resumeAtReset ?? false,
        broker: file?.broker ?? { mode: 'default' }
    });
    if (!keys) {
        await identity.persist();
    }
    return identity;
};
