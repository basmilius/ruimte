import { AuthChallengeResultSchema, type AuthSession, type EndpointInfo } from '@ruimte/contracts';
import { dropClientLocalOf } from '@/project/client-local';
import { browserStorage } from '@/project/last-project';
import { useBrowser } from '@/browser/registry';
import { projectClient } from '@/project';
import { forgetCachedList } from '@/project/list';
import { useChats } from '@/state/chats';
import { useDocument } from '@/state/document';
import { LOCAL_ENDPOINT_ID, activeEndpoint, endpointForDaemon, parsePairingUrl, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { useProject } from '@/state/project';
import { useProvidersStore } from '@/state/providers';
import { useServers } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useToasts } from '@/state/toasts';
import { useUsageStore } from '@/state/usage';
import { pool, transport } from '@/transport';
import { dropMachine } from '@/transport/connections';
import { useProcesses, useProcessWarnings } from '@/state/processes';
import { clientKey } from './client-key';
import { clientLabelFrom } from './client-label';
import { forgetTicket } from './credentials';
import { socketAddressFor } from './handshake';

/*
 * Pairs with a daemon on another machine: the pasted URL names the daemon and carries the one-time
 * token. This client registers its public key in the same request and signs for a ticket per
 * connection after that, so nothing long lived is written down on either side. A daemon from before
 * key pairs (and a browser without ed25519) falls back to the session token it answers with.
 *
 * Pinning the daemon's own key happens here too, over the one exchange nobody can be in the middle
 * of without the pairing token: from now on that machine has to sign to be believed.
 *
 * A daemon lands in the list once. Pairing with one that is already there is that machine on a
 * second address, and its row takes the address and the credential the pairing just handed out.
 */
export const pairEndpoint = async (pairingUrl: string): Promise<Endpoint> => {
    const parsed = parsePairingUrl(pairingUrl);
    if (!parsed) {
        throw new Error('That is not a pairing link. A pairing link looks like http://machine:4210/pair#token');
    }
    // Asked before the one-time token is spent, so a link for this machine's own daemon leaves no paired client behind.
    refuseOwnDaemon(await daemonAt(parsed.httpBaseUrl));
    const key = await clientKey();
    const response = await fetch(`${parsed.httpBaseUrl}/auth/pair`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ token: parsed.token, label: clientLabel(), ...(key ? { publicKey: key.publicKey } : {}) })
    });
    if (!response.ok) {
        throw new Error(await response.text().catch(() => 'That machine refused the pairing'));
    }
    const { sessionToken, endpoint } = (await response.json()) as { sessionToken?: string; endpoint: EndpointInfo };
    if (key && !endpoint.publicKey && !sessionToken) {
        throw new Error('That machine answered without a key or a token');
    }
    // Again with the id the daemon itself put in the pairing answer, for a daemon whose address said nothing.
    refuseOwnDaemon(endpoint.id);
    const known = endpointForDaemon(endpoint.id);
    // Keyed on the daemon's own id, so pairing with a machine that is already in the list under another address moves that row.
    const record: Endpoint = {
        id: endpoint.id,
        label: endpoint.label,
        httpBaseUrl: parsed.httpBaseUrl,
        wsBaseUrl: parsed.httpBaseUrl.replace(/^http/, 'ws'),
        reachability: endpoint.reachability,
        token: sessionToken ?? null,
        daemonId: endpoint.id,
        daemonPublicKey: key ? (endpoint.publicKey ?? null) : null
    };
    // A row under this id from an earlier pairing carried a ticket for a credential that is now gone.
    forgetTicket(record.id);
    useEndpoints.getState().add(record);
    // Pairing again with a machine that already has a socket hands out a new credential, so the socket follows the address it came on.
    pool.readdress(record.id, () => socketAddressFor(record.id));
    if (known) {
        useToasts.getState().show({
            id: `endpoint-merged-${record.id}`,
            kind: 'success',
            title: `${known.label} is already in the list`,
            description: `That link points to the same machine. Its address is now ${record.httpBaseUrl}.`
        });
    }
    return record;
};

/*
 * Who answers at an address, asked before anything is spent: the challenge route is what a daemon
 * tells anybody. Null for a daemon from before that route, which is answered for after the pairing.
 */
const daemonAt = async (httpBaseUrl: string): Promise<string | null> => {
    const answer = await fetch(`${httpBaseUrl}/auth/challenge`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' })
        .then((response) => (response.ok ? (response.json() as Promise<unknown>) : null))
        .catch(() => null);
    const parsed = AuthChallengeResultSchema.safeParse(answer);
    return parsed.success ? parsed.data.daemon.id : null;
};

/*
 * The one machine a pairing cannot add. The daemon that served this page is already in the list as
 * the local row, which reaches it over this page's own origin, without a credential and without a
 * row that can be forgotten; a second row for it would carry the same sessions and projects under a
 * key of its own. Updating the local row with the pasted address is not it either: in dev that
 * origin is Vite, and the address it answers on is the way back to the daemon behind it.
 */
const refuseOwnDaemon = (daemonId: string | null): void => {
    const known = daemonId === null ? null : endpointForDaemon(daemonId);
    if (known?.id === LOCAL_ENDPOINT_ID) {
        throw new Error(`That link is for the machine that served this page. It is already in the list as ${known.label}.`);
    }
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

/* Moves the whole client to another daemon: the canvas empties first, so nothing of the old one is recreated on the new. */
export const activateEndpoint = async (id: string): Promise<void> => {
    if (id === useEndpoints.getState().activeId) {
        return;
    }
    await projectClient.flush();
    useDocument.getState().load(null, null);
    useProject.getState().setCurrent(null, 0, null);
    useEndpoints.getState().setActive(id);
};

/* Forgetting the machine that is active goes home first, so the canvas is not left on a daemon nothing talks to. */
export const forgetEndpoint = async (id: string): Promise<void> => {
    if (id === useEndpoints.getState().activeId) {
        await activateEndpoint(LOCAL_ENDPOINT_ID);
    }
    useEndpoints.getState().remove(id);
    forgetTicket(id);
    dropMachine(id);
    pool.drop(id);
    forgetEndpointState(id);
};

/* Everything this client kept about a machine it no longer knows. */
const forgetEndpointState = (id: string): void => {
    useProjectList.getState().forgetProjects(id);
    forgetCachedList(id);
    useSessions.getState().clear(id);
    useChats.getState().clear(id);
    useBrowser.getState().clear(id);
    useServers.getState().forget(id);
    useProvidersStore.getState().forget(id);
    useUsageStore.getState().forget(id);
    useProcesses.getState().forget(id);
    useProcessWarnings.getState().forget(id);
    dropClientLocalOf(browserStorage(), id);
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

/* What the daemon lists this client as; `client-label.ts` holds the reading of it. */
const clientLabel = (): string => {
    const data = (navigator as Navigator & { userAgentData?: { brands?: { brand: string }[]; platform?: string } }).userAgentData;
    return clientLabelFrom({
        desktopPlatform: window.ruimteDesktop?.platform ?? null,
        brands: data?.brands ?? null,
        uaPlatform: data?.platform ?? null,
        userAgent: navigator.userAgent,
        platform: navigator.platform
    });
};

/* Opens the sockets this client keeps up on its own: the daemon that served the page, and the machine that is active. */
export const startEndpointSelection = (): (() => void) => {
    /* The machine that took over gets the socket it needs. What the machine that left answered stays
       where it is: every store is keyed on the endpoint, so nothing of it can show up under the new
       one. Its projects stay listed too, under its own name, which is what makes the menu a union. */
    const off = useEndpoints.subscribe((state, before) => {
        if (state.activeId !== before.activeId) {
            holdActive();
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
