import { externalActorId, isExternalActor, type ExternalGrant } from '@ruimte/contracts';

/* A client elsewhere that holds a credential a person made. It acts as that person, within the grant on the credential. */
export interface ExternalCaller {
    readonly kind: 'external';
    /* `external-<credential>`: apart from every node id and from Voice, so no lineage, claim or line ever mistakes it for one. */
    readonly id: string;
    readonly credentialId: string;
    /* The name a person reads for the client, taken at this request: a bearer's label, the host of an OAuth client's address. */
    readonly label: string;
    readonly grant: ExternalGrant;
}

export { externalActorId, isExternalActor };

export function externalActorTitle(caller: ExternalCaller): string {
    return `MCP · ${caller.label}`;
}
