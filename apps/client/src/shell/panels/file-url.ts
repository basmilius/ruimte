import { credentialFor } from '@/endpoint/credentials';
import { activeEndpoint, endpointById } from '@/state/endpoints';

/*
 * Where the bytes of an image the viewer draws come from. They live on the daemon and never travel
 * over the socket, so the URL carries the endpoint's credential the same way the socket does. The version
 * pins one set of bytes per URL, which is what lets the browser cache it forever; a write to the
 * file moves its mtime and the URL with it.
 *
 * The endpoint is the workspace's own (`useEndpointId`), because a panel of the project on the other
 * machine would otherwise ask this daemon for a path that only exists over there.
 */
export const fileBytesUrl = (path: string, mtime: number, size: number, endpointId?: string): string => {
    const endpoint = (endpointId === undefined ? null : endpointById(endpointId)) ?? activeEndpoint();
    const query = new URLSearchParams({ path, v: `${mtime}-${size}` });
    const credential = credentialFor(endpoint);
    if (credential) {
        query.set('token', credential);
    }
    return `${endpoint.httpBaseUrl}/fs/file?${query.toString()}`;
};

/*
 * The same file as a page the desktop shell can load. Every segment is percent-encoded, so a space,
 * a `#` or a `?` in a folder name stays part of the path instead of starting a fragment or a query,
 * and the page keeps the folder as its base: assets next to it resolve on their own.
 */
export const localFileUrl = (path: string): string => {
    const slashed = path.replaceAll('\\', '/');
    // A Windows path opens on its drive letter; the URL's own root goes in front of it.
    const rooted = slashed.startsWith('/') ? slashed : `/${slashed}`;
    return `file://${rooted.split('/').map(encodeURIComponent).join('/')}`;
};
