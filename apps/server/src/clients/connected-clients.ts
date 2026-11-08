import { WatchedSinks } from '@adecore/agents/host';
import type { ConnectedClient, EndpointInfoPayload } from '@ruimte/contracts';
import { isOwner } from '../auth/access.ts';
import type { ClientAccess } from '../dispatcher.ts';
import type { SessionEvent } from '../sessions/manager.ts';

type ClientDetails = Pick<ConnectedClient, 'client' | 'version' | 'os' | 'osVersion' | 'device'>;

interface Entry {
    access: ClientAccess;
    connectedAt: number;
    details: ClientDetails;
}

function accessOf(access: ClientAccess): string {
    if (access.peer !== undefined) {
        return 'machine';
    }

    return access.sessionId === null ? 'local' : 'account';
}

/*
 * The channels open on this machine now and what each client told of itself, in memory only. What a
 * client says is only shown: no check, limit or decision reads it. Who may get in is `auth.sessions`.
 */
export class ConnectedClients extends WatchedSinks<SessionEvent> {
    private readonly entries = new Map<string, Entry>();
    private readonly ownersOnly = new WeakSet<SessionEvent>();
    private readonly now: () => number;

    constructor(now: () => number) {
        super();
        this.now = now;
    }

    opened(clientId: string, access: ClientAccess): void {
        this.entries.set(clientId, { access, connectedAt: this.now(), details: {} });
        this.changed();
    }

    closed(clientId: string): void {
        if (this.entries.delete(clientId)) {
            this.changed();
        }
    }

    /* Only an `endpoint.info` that names its client tells of it, so the later one with `{}` wipes nothing. */
    announce(clientId: string, payload: EndpointInfoPayload): void {
        const entry = this.entries.get(clientId);

        if (entry === undefined || payload.client === undefined) {
            return;
        }

        entry.details = {
            client: payload.client,
            version: payload.clientVersion,
            os: payload.clientOs,
            osVersion: payload.clientOsVersion,
            device: payload.clientDevice
        };
        this.changed();
    }

    list(currentClientId: string, labelOf: (sessionId: string) => string | undefined): ConnectedClient[] {
        return [...this.entries].map(([id, { access, connectedAt, details }]) => {
            const label = access.sessionId === null ? undefined : labelOf(access.sessionId);

            return {
                id,
                access: accessOf(access),
                ...(label === undefined ? {} : { label }),
                ...(access.peer === undefined ? {} : { machineId: access.peer.machineId }),
                ...withoutAbsent(details),
                reachability: access.reachability,
                connectedAt,
                current: id === currentClientId
            };
        });
    }

    changed(): void {
        this.emit({ event: 'client.changed', payload: {} });
    }

    /* External MCP clients are on the owner's list only, so a change among them reaches only the owner's watches. */
    externalChanged(): void {
        const event: SessionEvent = { event: 'client.changed', payload: {} };

        this.ownersOnly.add(event);
        this.emit(event);
    }

    override subscribe(clientId: string, sink: (event: SessionEvent) => void): () => void {
        return super.subscribe(clientId, (event) => {
            if (this.ownersOnly.has(event) && !isOwner(this.entries.get(clientId)?.access)) {
                return;
            }

            sink(event);
        });
    }
}

function withoutAbsent(details: ClientDetails): ClientDetails {
    return Object.fromEntries(Object.entries(details).filter(([, value]) => value !== undefined));
}
