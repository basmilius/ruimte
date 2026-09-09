import type { EndpointInfo } from '@ruimte/contracts';
import { projectClient } from '@/project';
import { useCanvas } from '@/state/canvas';
import { activeEndpoint, parsePairingUrl, socketUrlFor, useEndpoints, type Endpoint } from '@/state/endpoints';
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
    const record: Endpoint = {
        id: new URL(parsed.httpBaseUrl).host,
        label: endpoint.label,
        httpBaseUrl: parsed.httpBaseUrl,
        wsBaseUrl: parsed.httpBaseUrl.replace(/^http/, 'ws'),
        reachability: endpoint.reachability,
        token: sessionToken
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
    useCanvas.getState().loadDocument(null, null);
    useProject.getState().setCurrent(null, 0);
    useProject.getState().setProjects([]);
    useEndpoints.getState().setActive(id);
    transport.switchTo?.(socketUrlFor(activeEndpoint()));
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
