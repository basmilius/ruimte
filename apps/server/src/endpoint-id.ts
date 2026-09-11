import { randomBytes } from 'node:crypto';
import { mkdir, readFile } from 'node:fs/promises';
import { hostname } from 'node:os';
import { dirname, join } from 'node:path';
import { ProjectIconChoiceSchema, type EndpointNameSource, type ProjectIconChoice } from '@ruimte/contracts';
import { z } from 'zod';
import { generateKeyPair, signMessage } from './auth/keys.ts';
import { isNotFound, writeAtomic } from './fs.ts';
import type { SessionEvent, SessionSink } from './sessions/manager.ts';

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
    icon: ProjectIconChoiceSchema.optional().catch(undefined)
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
    private readonly sinks = new Map<string, SessionSink>();
    private chosenName: string | null;
    private chosenIcon: ProjectIconChoice | null;

    constructor(options: IdentityOptions) {
        this.path = options.path;
        this.id = options.id;
        this.publicKey = options.publicKey;
        this.privateKey = options.privateKey;
        this.defaultName = options.defaultName;
        this.chosenName = options.name;
        this.chosenIcon = options.icon;
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

    /* Signs a message with the daemon's private key; the private half never leaves this object. */
    sign(message: string): string {
        return signMessage(this.privateKey, message);
    }

    subscribe(clientId: string, sink: SessionSink): () => void {
        this.sinks.set(clientId, sink);
        return () => {
            if (this.sinks.get(clientId) === sink) {
                this.sinks.delete(clientId);
            }
        };
    }

    /* A null name hands the machine back to the one it starts with; a null icon leaves it without one. */
    async setIdentity(name: string | null, icon: ProjectIconChoice | null): Promise<void> {
        this.chosenName = name;
        this.chosenIcon = icon;
        await this.persist();
        const event: SessionEvent = {
            event: 'endpoint.changed',
            payload: { id: this.id, label: this.label, nameSource: this.nameSource, icon: this.chosenIcon }
        };
        for (const sink of this.sinks.values()) {
            sink(event);
        }
    }

    /* Writes the file as this object stands; a fresh home is written the moment it is minted. */
    async persist(): Promise<void> {
        const file = {
            version: 1,
            id: this.id,
            publicKey: this.publicKey,
            privateKey: this.privateKey,
            ...(this.chosenName === null ? {} : { name: this.chosenName }),
            ...(this.chosenIcon === null ? {} : { icon: this.chosenIcon })
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
            console.warn('The endpoint id file would not parse; minting a new id', e);
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
        icon: file?.icon ?? null
    });
    if (!keys) {
        await identity.persist();
    }
    return identity;
};
