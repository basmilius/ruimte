import { activeEndpoint, endpointById } from '@/state/endpoints';

/*
 * Where a project's image icon comes from. The bytes live on the daemon, never in the canvas file,
 * so the URL carries the endpoint's token the same way the socket does. The version pins one set
 * of bytes per URL, which is what lets the browser cache it forever.
 *
 * A list that spans machines names the endpoint of the row: asking the active daemon for another
 * machine's icon would paint both sets of icons through one daemon's token.
 */
export const projectIconUrl = (projectId: string, version: string, theme: 'light' | 'dark', endpointId?: string): string => {
    const endpoint = (endpointId === undefined ? null : endpointById(endpointId)) ?? activeEndpoint();
    const query = new URLSearchParams({ v: version, theme });
    if (endpoint.token) {
        query.set('token', endpoint.token);
    }
    return `${endpoint.httpBaseUrl}/projects/${encodeURIComponent(projectId)}/icon?${query.toString()}`;
};
