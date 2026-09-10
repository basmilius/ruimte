import { activeEndpoint } from '@/state/endpoints';

/*
 * Where the bytes of an image the viewer draws come from. They live on the daemon and never travel
 * over the socket, so the URL carries the endpoint's token the same way the socket does. The version
 * pins one set of bytes per URL, which is what lets the browser cache it forever; a write to the
 * file moves its mtime and the URL with it.
 */
export const fileBytesUrl = (path: string, mtime: number, size: number): string => {
    const endpoint = activeEndpoint();
    const query = new URLSearchParams({ path, v: `${mtime}-${size}` });
    if (endpoint.token) {
        query.set('token', endpoint.token);
    }
    return `${endpoint.httpBaseUrl}/fs/file?${query.toString()}`;
};
