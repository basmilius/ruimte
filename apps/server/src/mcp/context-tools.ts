import type { ActionResult } from '@ruimte/actions';
import { serverActionCall } from '../actions/context.ts';
import { serverActions } from '../actions/server-actions.ts';
import { linesOf } from '../canvas/action-verb.ts';
import { reachedPlace } from '../canvas/reach.ts';
import { VerbRefusal, type CanvasHost } from '../canvas/verb.ts';
import { countVerb } from '../stats/usage-stats.ts';

/* The refusals of a read that name a source the caller cannot read, which the linked list then goes under. */
const UNREAD: ReadonlySet<string> = new Set(['unknown-source', 'not-linked', 'unreadable', 'view-required', 'not-on-view', 'not-a-chat-view', 'not-a-canvas']);

export interface ContextRead {
    id: string;
    tail: number | null;
    subagent: string | null;
    view: string | null;
    project: string | null;
    form: 'elements' | 'image' | null;
}

interface ListedSource {
    id: string;
    kind: string;
    title: string;
    flag?: string;
    snoozedUntil?: string;
}

function refused(result: ActionResult): VerbRefusal {
    if (result.status !== 'failed') {
        return new VerbRefusal('read-failed', `The read answered ${result.status}`);
    }

    return new VerbRefusal(result.error.code, result.error.message, linesOf(result.error.details));
}

async function listed(host: CanvasHost, caller: string): Promise<ListedSource[]> {
    const result = await serverActions.execute('context.list', {}, serverActionCall(host, host.projects.locate(caller), caller));

    if (result.status !== 'completed') {
        throw refused(result);
    }

    return result.output.sources;
}

/* `id kind title flag snoozed` per source a person linked to the caller, or a note that there is none. */
export async function listContext(host: CanvasHost, caller: string): Promise<string[]> {
    const sources = await listed(host, caller);
    countVerb('list');

    if (sources.length === 0) {
        return ['note\tNothing is linked to this session'];
    }

    return sources.map((source) => `${source.id}\t${source.kind}\t${source.title}\t${source.flag ?? '-'}\t${source.snoozedUntil ?? '-'}`);
}

/* One source as text; a source the caller cannot read is refused with what it can read under it. */
export async function readContext(host: CanvasHost, caller: string, read: ContextRead): Promise<string[]> {
    const own = host.projects.locate(caller);
    const reached = read.project === null ? null : await reachedPlace(host, caller, read.project);
    const call = reached === null ? serverActionCall(host, own, caller) : serverActionCall(host, reached, caller, false, undefined, own ?? undefined);
    const result = await serverActions.execute(
        'context.read',
        { sourceId: read.id, tail: read.tail, subagent: read.subagent, viewId: read.view, form: read.form },
        call
    );

    if (result.status === 'completed') {
        countVerb('read');

        return [result.output.text];
    }

    const refusal = refused(result);

    if (!UNREAD.has(refusal.code)) {
        throw refusal;
    }

    const sources = await listed(host, caller).catch(() => null);
    const linked = sources?.map((source) => `${source.id}\t${source.kind}\t${source.title}`) ?? [];

    throw new VerbRefusal(refusal.code, refusal.message, [...linked, ...refusal.lines]);
}
