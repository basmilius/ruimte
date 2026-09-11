import type { AuthSession, EndpointInfo } from '@ruimte/contracts';
import { projectClient } from '@/project';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, activeEndpoint, parsePairingUrl, socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { transport } from '@/transport';

/*
 * Pairs with a daemon on another machine: the pasted URL names the daemon and carries the
 * one-time token; the daemon answers with a session token this client keeps for that endpoint.
 */
export const pairEndpoint = async (pairingUrl: string): Promise<Endpoint> => {
    const parsed = parsePairingUrl(pairingUrl);
    if (!parsed) {
        throw new Error('That is not a pairing link; it looks like http://machine:4210/pair#token');
    }
    const response = await fetch(`${parsed.httpBaseUrl}/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: parsed.token, label: clientLabel() })
    });
    if (!response.ok) {
        throw new Error(await response.text().catch(() => 'The daemon refused the pairing'));
    }
    const { sessionToken, endpoint } = (await response.json()) as { sessionToken: string; endpoint: EndpointInfo };
    // Keyed on the daemon's own id, so pairing with a machine that is already in the list under another address moves that row.
    const record: Endpoint = {
        id: endpoint.id,
        label: endpoint.label,
        httpBaseUrl: parsed.httpBaseUrl,
        wsBaseUrl: parsed.httpBaseUrl.replace(/^http/, 'ws'),
        reachability: endpoint.reachability,
        token: sessionToken,
        daemonId: endpoint.id
    };
    useEndpoints.getState().add(record);
    return record;
};

/* Moves the whole client to another daemon: the canvas empties first, so nothing of the old one is recreated on the new. */
export const activateEndpoint = async (id: string): Promise<void> => {
    if (id === useEndpoints.getState().activeId) {
        return;
    }
    await projectClient.flush();
    useDocument.getState().load(null, null);
    useProject.getState().setCurrent(null, 0);
    useProject.getState().setProjects([]);
    useEndpoints.getState().setActive(id);
    transport.switchTo?.(socketUrlFor(activeEndpoint()));
};

/* The clients paired with the daemon this client talks to right now. */
export const listPairedClients = async (): Promise<AuthSession[]> => (await transport.request('auth.sessions', {})).sessions;

/* A fresh one-time pairing link from the active daemon; it only answers a client on its own machine. */
export const requestPairingUrl = async (): Promise<string> => (await transport.request('auth.pairingToken', {})).url;

/* Takes a paired client's access away. Revoking this client's own session forgets the endpoint and goes home to the loopback daemon. */
export const revokePairedClient = async (session: AuthSession): Promise<void> => {
    await transport.request('auth.revoke', { id: session.id });
    if (!session.current) {
        return;
    }
    const revoked = activeEndpoint();
    await activateEndpoint(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(revoked.id);
};

/* What the daemon lists this client as: the browser on this machine. */
const clientLabel = (): string => {
    const platform = window.ruimteDesktop?.platform ?? navigator.platform;
    return `${window.ruimteDesktop ? 'Ruimte' : 'Browser'} on ${platform}`;
};

/* On startup the transport was built for the page's own daemon; a remembered remote endpoint takes over here. */
export const startEndpointSelection = (): void => {
    const endpoint = activeEndpoint();
    if (endpoint.token) {
        transport.switchTo?.(socketUrlFor(endpoint));
    }
};
