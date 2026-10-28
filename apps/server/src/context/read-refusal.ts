import { isAgentKind, lineEndOf, nodeChats, type ContextSource, type ProjectCanvasView } from '@ruimte/contracts';
import type { ParsedRefusal } from '@adecore/agents/context';

function body(code: string, message: string, ...lines: string[]): ParsedRefusal {
    return { code, message, lines };
}

/* The line that draws what the read needs. It names both ends rather than the shorter --to, since
   the direction is the whole misunderstanding here and only --from spells it out. */
function drawLine(sourceId: string, readerId: string): string {
    return `see\truimte-context link new --from ${sourceId} --to ${readerId}\tdraws the line this read needs, and leaves any line that is there`;
}

/* The other way in besides a line, which only a person gives. */
function referenceLine(sourceId: string): string {
    return `note\tA person who points at ${sourceId} with # in a message to you lets you read it too, with no line`;
}

/*
 * Why a read found nothing. Only the daemon has the project, so only it can tell a neighbor whose
 * line runs the other way from an id that is on no canvas at all.
 */
export function readRefusal(readerId: string, sourceId: string, sources: readonly ContextSource[], canvas: ProjectCanvasView | null): ParsedRefusal {
    // The line is there and the read still came back empty, so calling it unlinked would be untrue.
    if (sources.some((source) => source.id === sourceId || source.nodeId === sourceId)) {
        return body('unreadable', `${sourceId} is linked into you, but there is nothing to read in it right now`);
    }
    if (!canvas) {
        return body('unknown-source', `${sourceId} is not linked to this session`, referenceLine(sourceId));
    }
    /* A drawing or a diagram is read under its view id, and a later chat of a design under its own,
       while the line runs into the node showing it. */
    const node = canvas.nodes.find(
        (candidate) => candidate.id === sourceId || candidate.viewId === sourceId || nodeChats(candidate).some((chat) => chat.id === sourceId)
    );
    const text = canvas.texts.find((candidate) => candidate.id === sourceId);
    if (!node && !text) {
        return body('unknown-source', `${sourceId} is not linked to this session, and no node of ${canvas.id} carries that id either`);
    }
    const linkId = node?.id ?? sourceId;
    const readerEnd = lineEndOf(canvas.nodes, readerId);
    const what = node ? `a ${node.kind} node` : 'a text';
    if (canvas.edges.some((edge) => edge.from === readerEnd && edge.to === linkId)) {
        return body(
            'not-linked',
            `${sourceId} is ${what} on ${canvas.id} with a line from you into it, which is what makes you readable to it; reading it takes a line the other way`,
            drawLine(linkId, readerEnd),
            referenceLine(linkId)
        );
    }
    // Only between two agents does the direction decide who reads; any other line reads either way.
    const missing = node !== undefined && isAgentKind(node.kind) ? 'no line runs from it into you' : 'no line joins it to you';
    return body(
        'not-linked',
        `${sourceId} is ${what} on ${canvas.id}, but ${missing}, and that line is what a read takes`,
        drawLine(linkId, readerEnd),
        referenceLine(linkId)
    );
}
