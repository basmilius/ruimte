import { activeEndpoint } from '@/state/endpoints';

/*
 * Where a project's image icon comes from. The bytes live on the daemon, never in the canvas file,
 * so the URL carries the endpoint's token the same way the socket does. The version pins one set
 * of bytes per URL, which is what lets the browser cache it forever.
 */
export const projectIconUrl = (projectId: string, version: string, theme: 'light' | 'dark'): string => {
    const endpoint = activeEndpoint();
    const query = new URLSearchParams({ v: version, theme });
    if (endpoint.token) {
        query.set('token', endpoint.token);
    }
    return `${endpoint.httpBaseUrl}/projects/${encodeURIComponent(projectId)}/icon?${query.toString()}`;
};
