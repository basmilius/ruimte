import i18next from 'i18next';
import { AuthChallengeResultSchema, type AuthSession, type EndpointInfo } from '@ruimte/contracts';
import { dropClientLocalOf } from '@/project/client-local';
import { browserStorage } from '@/project/last-project';
import { useBrowser } from '@/browser/registry';
import { forgetCachedList } from '@/project/list';
import { useChats } from '@/state/chats';
import { useLastSeen } from '@/state/last-seen';
import { LOCAL_ENDPOINT_ID, activeEndpoint, endpointForDaemon, parsePairingUrl, useEndpoints, type Endpoint } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { useProvidersStore } from '@/state/providers';
import { useServers } from '@/state/server';
import { useSessions } from '@/state/sessions';
import { useToasts } from '@/state/toasts';
import { useUsageStore } from '@/state/usage';
import { mixedContentRefusal } from '@/station';
import { connectionAddressFor, pool, transport } from '@/transport';
import { dropMachine, leaveWorkspace, showStart } from '@/transport/connections';
import { windowWorkspace } from '@/state/window';
import { useProcesses, useProcessWarnings } from '@/state/processes';
import { clientKey } from './client-key';
import { currentClientLabel } from './client-label';
import { forgetTicket } from './credentials';

/*
 * Pairing exchanges the one-time token for pinned keys and per-connection tickets. Legacy daemons
 * fall back to a session token; pairing an existing daemon updates its address instead of adding it.
 */
export const pairEndpoint = async (pairingUrl: string): Promise<Endpoint> => {
    const parsed = parsePairingUrl(pairingUrl);
    if (!parsed) {
        throw new Error(i18next.t('machines:pairing.notALink'));
    }
    const refusal = typeof location === 'undefined' ? null : mixedContentRefusal(location.protocol, parsed.httpBaseUrl);
    if (refusal !== null) {
        throw new Error(refusal);
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
        throw new Error(await response.text().catch(() => i18next.t('machines:pairing.refused')));
    }
    const { sessionToken, endpoint } = (await response.json()) as { sessionToken?: string; endpoint: EndpointInfo };
    if (key && !endpoint.publicKey && !sessionToken) {
        throw new Error(i18next.t('machines:pairing.noKeyOrToken'));
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
        daemonPublicKey: key ? (endpoint.publicKey ?? null) : null,
        brokerUrl: endpoint.brokerUrl ?? null
    };
    // A row under this id from an earlier pairing carried a ticket for a credential that is now gone.
    forgetTicket(record.id);
    useEndpoints.getState().add(record);
    // Pairing again with a machine that already has a socket hands out a new credential, so the socket follows the address it came on.
    pool.readdress(record.id, () => connectionAddressFor(record.id));
    if (known) {
        useToasts.getState().show({
            id: `endpoint-merged-${record.id}`,
            kind: 'success',
            title: i18next.t('machines:pairing.merged.title', { label: known.label }),
            description: i18next.t('machines:pairing.merged.description', { address: record.httpBaseUrl })
        });
    }
    return record;
};

/*
 * Who answers at an address, asked before anything is spent, since the challenge route is open to
 * anybody. Null for a daemon from before that route existed; identity is resolved after the
 * pairing instead.
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
 * the local row. It reaches this machine over the page's own origin, with the secret the desktop
 * shell hands over, and it is not a row that can be forgotten; a second row for it would carry the
 * same sessions and projects under a key of its own. Updating the local row with the pasted address
 * is not an option either, because in dev that origin is Vite, and the address it answers on is the
 * way back to the daemon behind it.
 */
const refuseOwnDaemon = (daemonId: string | null): void => {
    const known = daemonId === null ? null : endpointForDaemon(daemonId);
    if (known?.id === LOCAL_ENDPOINT_ID) {
        throw new Error(i18next.t('machines:pairing.ownDaemon', { label: known.label }));
    }
};

/* Forgetting the machine the open project is on takes the window back to the start screen first, so nothing is left on a daemon nothing talks to. */
export const forgetEndpoint = async (id: string): Promise<void> => {
    if (windowWorkspace()?.connection.endpointId === id) {
        await leaveWorkspace().catch(() => undefined);
        showStart();
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
    useLastSeen.getState().forget(id);
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
const clientLabel = (): string => currentClientLabel();
