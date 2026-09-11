import type { AuthSession, EndpointInfo } from '@ruimte/contracts';
import { projectClient } from '@/project';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, activeEndpoint, parsePairingUrl, socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProject } from '@/state/project';
import { useProviders } from '@/state/providers';
import { useServer } from '@/state/server';
import { useUsage } from '@/state/usage';
import { pool, transport } from '@/transport';

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
    // Pairing again with a machine that already has a socket hands out a new token, so the socket follows the address it came on.
    pool.readdress(record.id, socketUrlFor(record));
    return record;
};

/*
 * The machine that is active keeps its socket for as long as it is active. The pool lets go of the
 * one before it, which then has half a minute to be picked again before it closes.
 */
let releaseActive: (() => void) | null = null;

const holdActive = (): void => {
    const release = releaseActive;
    releaseActive = pool.hold(activeEndpoint());
    release?.();
};

/*
 * Everything one daemon answered goes, and the machine that took over gets the socket it needs. It
 * hangs off the store rather than off the click, because the active endpoint also moves when a
 * client revokes its own session, and later when a project on another machine is opened.
 */
const onActiveEndpointChanged = (): void => {
    useProject.getState().setProjects([]);
    useServer.getState().clear();
    useProviders.getState().clear();
    useUsage.getState().clear();
    holdActive();
};

/* Moves the whole client to another daemon: the canvas empties first, so nothing of the old one is recreated on the new. */
export const activateEndpoint = async (id: string): Promise<void> => {
    if (id === useEndpoints.getState().activeId) {
        return;
    }
    await projectClient.flush();
    useDocument.getState().load(null, null);
    useProject.getState().setCurrent(null, 0);
    useEndpoints.getState().setActive(id);
};

/* Forgetting the machine that is active goes home first, so the canvas is not left on a daemon nothing talks to. */
export const forgetEndpoint = async (id: string): Promise<void> => {
    if (id === useEndpoints.getState().activeId) {
        await activateEndpoint(LOCAL_ENDPOINT_ID);
    }
    useEndpoints.getState().remove(id);
    pool.drop(id);
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
    await forgetEndpoint(activeEndpoint().id);
};

/* What the daemon lists this client as: the browser on this machine. */
const clientLabel = (): string => {
    const platform = window.ruimteDesktop?.platform ?? navigator.platform;
    return `${window.ruimteDesktop ? 'Ruimte' : 'Browser'} on ${platform}`;
};

/* Opens the sockets this client keeps up on its own: the daemon that served the page, and the machine that is active. */
export const startEndpointSelection = (): (() => void) => {
    const off = useEndpoints.subscribe((state, before) => {
        if (state.activeId !== before.activeId) {
            onActiveEndpointChanged();
        }
    });
    // The page's own daemon never closes: it is where the app lands when a machine is forgotten or stops answering.
    const local = useEndpoints.getState().endpoints.find((endpoint) => endpoint.id === LOCAL_ENDPOINT_ID);
    const releaseLocal = local ? pool.hold(local) : null;
    holdActive();
    return () => {
        off();
        releaseLocal?.();
    };
};
