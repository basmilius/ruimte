import { isAgentKind, type ContextSource, type ProjectCanvasView } from '@ruimte/contracts';
import type { ParsedRefusal } from '../refusal.ts';

const body = (code: string, message: string, ...lines: string[]): ParsedRefusal => ({ code, message, lines });

/* The line that draws what the read needs. It names both ends rather than the shorter --to, since
   the direction is the whole misunderstanding here and only --from spells it out. */
const drawLine = (sourceId: string, readerId: string): string =>
    `see\truimte-context link new --from ${sourceId} --to ${readerId}\tdraws the line this read needs, and leaves any line that is there`;

/*
 * Why a read found nothing, which a refused read answers with. The CLI knows only the sources it was handed,
 * so it cannot tell a neighbor whose line runs the other way from an id that is on no canvas at
 * all; the daemon has the project, so the sentence that says which of the two it is comes from here.
 */
export const readRefusal = (readerId: string, sourceId: string, sources: readonly ContextSource[], canvas: ProjectCanvasView | null): ParsedRefusal => {
    // The line is there and the read still came back empty, so calling it unlinked would be untrue.
    if (sources.some((source) => source.id === sourceId || source.nodeId === sourceId)) {
        return body('unreadable', `${sourceId} is linked into you, but there is nothing to read in it right now`);
    }
    if (!canvas) {
        return body('unknown-source', `${sourceId} is not linked to this session`);
    }
    // A drawing or a diagram is read under its view id, while the line runs into the node showing it.
    const node = canvas.nodes.find((candidate) => candidate.id === sourceId || candidate.viewId === sourceId);
    const text = canvas.texts.find((candidate) => candidate.id === sourceId);
    if (!node && !text) {
        return body('unknown-source', `${sourceId} is not linked to this session, and no node of ${canvas.id} carries that id either`);
    }
    const linkId = node?.id ?? sourceId;
    const what = node ? `a ${node.kind} node` : 'a text';
    if (canvas.edges.some((edge) => edge.from === readerId && edge.to === linkId)) {
        return body(
            'not-linked',
            `${sourceId} is ${what} on ${canvas.id} with a line from you into it, which is what makes you readable to it; reading it takes a line the other way`,
            drawLine(linkId, readerId)
        );
    }
    // Only between two agents does the direction decide who reads; any other line reads either way.
    const missing = node !== undefined && isAgentKind(node.kind) ? 'no line runs from it into you' : 'no line joins it to you';
    return body('not-linked', `${sourceId} is ${what} on ${canvas.id}, but ${missing}, and that line is what a read takes`, drawLine(linkId, readerId));
};
