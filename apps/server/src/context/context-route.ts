import type { ActionResult } from '@ruimte/actions';
import { serverActionCall } from '../actions/context.ts';
import { serverActions } from '../actions/server-actions.ts';
import { linesOf } from '../canvas/action-verb.ts';
import { bearerCaller } from '../canvas/canvas-route.ts';
import { VerbRefusal, type CanvasHost } from '../canvas/verb.ts';
import { reachedPlace } from '../canvas/reach.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import { refusalRows } from '@adecore/agents/context';
import { CONTEXT_PATH } from './context-store.ts';
import { READ_FORM_REFUSALS, type ReadForm } from './read-forms.ts';
import { countVerb } from '../stats/usage-stats.ts';

/* The refusals of a read that the CLI prints as its own, with what `list` would have said under them;
   the last four are a chat view's, which reads a node by naming its canvas. */
const UNREAD: ReadonlySet<string> = new Set(['unknown-source', 'not-linked', 'unreadable', 'view-required', 'not-on-view', 'not-a-chat-view', 'not-a-canvas']);

const TEXT = { 'content-type': 'text/plain; charset=utf-8' };

/*
 * The statuses a `ruimte-context` of any build reads: a 404 carries the refusal rows of a source that
 * could not be read, a 422 the sentence about a subagent, and anything else is the daemon failing.
 */
function failed(result: ActionResult): Response {
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
    if (READ_FORM_REFUSALS.has(error.code) || error.code === 'bad-arguments') {
        return new Response(refusalRows(error.code, error.message, linesOf(error.details)), { status: 422, headers: TEXT });
    }
    return new Response(`The read failed: ${error.message}`, { status: 500, headers: TEXT });
}

interface ContextRouteDeps {
    /* The session or chat a bearer token speaks for. */
    targetForToken(token: string): string | null;
    host: CanvasHost;
}

/*
 * `GET /context` lists, `GET /context/<id>[?tail=N][&subagent=T][&view=V][&form=F][&json]` reads; the bearer token names the
 * agent asking. Both run `context.list` and `context.read`, so the CLI is one adapter among others.
 */
export async function handleContextRequest(request: Request, pathname: string, deps: ContextRouteDeps): Promise<Response> {
    if (request.method !== 'GET') {
        return new Response('Method not allowed', { status: 405 });
    }
    const caller = bearerCaller(request, deps.targetForToken);
    if (!caller) {
        return new Response('Unknown token', { status: 401 });
    }
    const call = serverActionCall(deps.host, deps.host.projects.locate(caller), caller);
    const rest = pathname.slice(CONTEXT_PATH.length).replace(/^\//, '');
    if (rest === '') {
        const listed = await serverActions.execute('context.list', {}, call);
        if (listed.status !== 'completed') {
            return failed(listed);
        }
        countVerb('list');
        return Response.json({ sources: listed.output.sources });
    }
    const query = new URL(request.url).searchParams;
    const asked = query.get('tail');
    const tail = asked === null ? null : Number(asked);
    if (tail !== null && (!Number.isInteger(tail) || tail < 1)) {
        return new Response('tail takes a positive whole number of lines', { status: 400 });
    }
    let sourceId: string;
    try {
        sourceId = decodeURIComponent(rest);
    } catch {
        return new Response('The source id is not valid percent-encoding', { status: 400 });
    }
    const asForm = query.get('form');
    if (asForm !== null && asForm !== 'elements' && asForm !== 'image') {
        return new Response('form takes elements or image', { status: 400 });
    }
    const form: ReadForm | null = asForm;
    const project = query.get('project');
    let reached: IndexedPlace | null = null;
    if (project !== null) {
        try {
            reached = await reachedPlace(deps.host, caller, project);
        } catch (e) {
            if (e instanceof VerbRefusal) {
                return new Response(refusalRows(e.code, e.message, e.lines), { status: 422, headers: TEXT });
            }
            throw e;
        }
    }
    const read = await serverActions.execute(
        'context.read',
        { sourceId, tail, subagent: query.get('subagent') || null, viewId: query.get('view') || null, form },
        reached === null ? call : serverActionCall(deps.host, reached, caller, false, undefined, deps.host.projects.locate(caller) ?? undefined)
    );
    if (read.status !== 'completed') {
        return failed(read);
    }
    countVerb('read');
    return query.has('json') ? Response.json(read.output) : new Response(read.output.text, { headers: TEXT });
}
