import { parseAuthority } from './http-head';

/*
 * Where a page of a tunnel may go: the one port of the grant on the loopback spellings, over http or ws, and the
 * documents and memory the page makes itself. Everything else, an outside address included, is refused rather than
 * opened on this computer: the page has no connection of its own, and none is made for it behind its back.
 */
export function tunnelDestinationAllowed(url: string, port: number): boolean {
    if (url === 'about:blank' || url.startsWith('data:') || url.startsWith('blob:')) {
        return true;
    }

    const match = /^(?:http|ws):\/\/([^/?#\s@]+)(?:[/?#]|$)/i.exec(url);
    const authority = match === null ? null : parseAuthority(match[1]!);

    return authority !== null && authority.port === port;
}

/* A page of a tunnel without a window that made it may load nothing but the blank document. */
export function tunnelDestinationAllowedFor(owned: boolean, url: string, port: number): boolean {
    return url === 'about:blank' || (owned && tunnelDestinationAllowed(url, port));
}
