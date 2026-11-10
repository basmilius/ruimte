import type { Server } from 'bun';

interface RouteRequest<Data> {
    request: Request;
    url: URL;
    /* The address the request came from; empty when the server cannot tell. */
    remote: string;
    server: Server<Data>;
}

/* Undefined once the request became a socket, which has no response of its own. */
type RouteHandler<Data> = (route: RouteRequest<Data>) => Promise<Response | undefined> | Response | undefined;

export interface Route<Data> {
    exact?: readonly string[];
    /* A prefix whose every path below it is answered; the prefix itself only when `exact` names it too. */
    below?: string;
    /* The largest body a request here may declare, past the one every other route takes. */
    bodyBytes?: number;
    handle: RouteHandler<Data>;
}

/* The first route that answers a path, in the order of the table. */
export function routeFor<Data>(routes: readonly Route<Data>[], pathname: string): Route<Data> | null {
    return routes.find((route) => route.exact?.includes(pathname) === true || (route.below !== undefined && pathname.startsWith(`${route.below}/`))) ?? null;
}

/*
 * Answers a request from the table, and 404 for a path no route answers. A body declared past what its
 * route takes is refused before anything reads it; one sent without a length stops at the server's ceiling.
 */
export async function answerRoute<Data>(
    routes: readonly Route<Data>[],
    request: Request,
    server: Server<Data>,
    bodyBytes = Number.POSITIVE_INFINITY
): Promise<Response | undefined> {
    const url = new URL(request.url);
    const route = routeFor(routes, url.pathname);
    if (route === null) {
        return new Response('Not found', { status: 404 });
    }
    if (Number(request.headers.get('content-length') ?? 0) > (route.bodyBytes ?? bodyBytes)) {
        return new Response('Payload too large', { status: 413 });
    }
    return route.handle({ request, url, remote: server.requestIP(request)?.address ?? '', server });
}
