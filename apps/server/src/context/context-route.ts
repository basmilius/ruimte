import type { ActionResult } from '@ruimte/actions';
import { serverActionCall } from '../actions/context.ts';
import { serverActions } from '../actions/server-actions.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import { refusalRows } from '../refusal.ts';
import { CONTEXT_PATH } from './context-store.ts';

/* The refusals of a read that the CLI prints as its own, with what `list` would have said under them. */
const UNREAD: ReadonlySet<string> = new Set(['unknown-source', 'not-linked', 'unreadable']);

const TEXT = { 'content-type': 'text/plain; charset=utf-8' };

const linesOf = (details: unknown): string[] => (Array.isArray(details) && details.every((line) => typeof line === 'string') ? (details as string[]) : []);

/*
 * The statuses a `ruimte-context` of any build reads: a 404 carries the refusal rows of a source that
 * could not be read, a 422 the sentence about a subagent, and anything else is the daemon failing.
 */
const failed = (result: ActionResult): Response => {
    if (result.status !== 'failed') {
        return new Response(`The read answered ${result.status}`, { status: 500, headers: TEXT });
    }
    const { error } = result;
    if (UNREAD.has(error.code)) {
        return new Response(refusalRows(error.code, error.message, linesOf(error.details)), { status: 404, headers: TEXT });
    }
    if (error.code === 'unknown-subagent') {
        return new Response(error.message, { status: 422, headers: TEXT });
    }
    return new Response(`The read failed: ${error.message}`, { status: 500, headers: TEXT });
};

interface ContextRouteDeps {
    /* The session or chat a bearer token speaks for. */
    targetForToken(token: string): string | null;
    host: CanvasHost;
}

/*
 * `GET /context` lists, `GET /context/<id>[?tail=N][&subagent=T]` reads; the bearer token names the
 * agent asking. Both run `context.list` and `context.read`, so the CLI is one adapter among others.
 */
export const handleContextRequest = async (request: Request, pathname: string, deps: ContextRouteDeps): Promise<Response> => {
    if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
    }
    const header = request.headers.get('authorization') ?? '';
    const token = header.startsWith('Bearer ') ? header.slice(7).trim() : '';
    const caller = token ? deps.targetForToken(token) : null;
    if (!caller) {
        return new Response('Unknown token', { status: 401 });
    }
    const call = serverActionCall(deps.host, deps.host.locate(caller), caller);
    const rest = pathname.slice(CONTEXT_PATH.length).replace(/^\//, '');
    if (rest === '') {
        const listed = await serverActions.execute('context.list', {}, call);
        return listed.status === 'completed' ? Response.json({ sources: listed.output.sources }) : failed(listed);
    }
    const query = new URL(request.url).searchParams;
    const asked = query.get('tail');
    const tail = asked === null ? null : Number(asked);
    if (tail !== null && (!Number.isInteger(tail) || tail < 1)) {
        return new Response('tail takes a positive whole number of lines', { status: 400 });
    }
    const read = await serverActions.execute('context.read', { sourceId: decodeURIComponent(rest), tail, subagent: query.get('subagent') || null }, call);
    return read.status === 'completed' ? new Response(read.output.text, { headers: TEXT }) : failed(read);
};
