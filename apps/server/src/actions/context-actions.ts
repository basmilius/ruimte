import type { ActionHandlers } from '@ruimte/actions';
import { CodedError } from '@adecore/agents';
import { canvasContextSources, type ContextSource } from '@ruimte/contracts';
import { arrangedCanvas, canvasHolding, isChatView, notOnView, viewRequired } from '../canvas/chat-view.ts';
import { VerbRefusal, snoozedAt, type ContextHost } from '../canvas/verb.ts';
import { refuseOtherMachine } from '../canvas/remote-node.ts';
import { ContextRefusal } from '../context/context-store.ts';
import type { ServerActionContext } from './context.ts';

function contextOf(context: ServerActionContext): ContextHost {
    if (!context.host.context) {
        throw new VerbRefusal('no-context', 'This machine keeps no linked context');
    }
    return context.host.context;
}

/*
 * The source a chat view reads on the canvas it named, with no line to it; null for an id that is on
 * no canvas, which may still be an agent the chat opened itself.
 */
async function arrangedSource({ host, place }: ServerActionContext, caller: string, sourceId: string, viewId: string): Promise<ContextSource | null> {
    const content = await host.projects.read(place.projectId);
    const canvas = arrangedCanvas(content, caller, viewId)!;
    const source = canvasContextSources(canvas, place.folder).find((candidate) => candidate.id === sourceId || candidate.nodeId === sourceId);
    if (source) {
        return source;
    }
    const holding = canvasHolding(content, sourceId);
    if (holding && holding.id !== canvas.id) {
        throw notOnView(sourceId, holding, canvas, `read ${sourceId}`);
    }
    if (holding) {
        throw new ContextRefusal('unreadable', `${sourceId} is on ${canvas.id}, but it holds nothing to read`);
    }
    return null;
}

/* Why a chat view's read of a node found nothing: it named no canvas, which is what stands in for a line. */
async function chatViewRefusal({ host }: ServerActionContext, caller: string, sourceId: string): Promise<VerbRefusal | null> {
    const place = host.projects.locate(caller);
    if (place === null) {
        return null;
    }
    const content = await host.projects.read(place.projectId);
    const holding = canvasHolding(content, sourceId);
    return holding && isChatView(content, caller) ? viewRequired(sourceId, holding, `read ${sourceId}`) : null;
}

/* What a person linked into the caller: only a line it sits on, or the frame of a group, makes a source readable. */
export const contextActions: ActionHandlers<ServerActionContext> = {
    'context.list': (_input, { actor, context }) => ({
        output: {
            sources: contextOf(context)
                .list(actor.id)
                .map((source) => {
                    const snoozedUntil = snoozedAt(context.host, source.id);
                    return snoozedUntil === null ? source : { ...source, snoozedUntil };
                })
        }
    }),
    'context.read': async ({ sourceId, tail, subagent, viewId }, { actor, context }) => {
        const store = contextOf(context);
        refuseOtherMachine(context.host, sourceId);
        const arranged = viewId == null ? null : await arrangedSource(context, actor.id, sourceId, viewId);
        if (arranged) {
            return { output: await store.answerSource(actor.id, arranged, tail ?? null, subagent ?? null) };
        }
        try {
            return { output: await store.answer(actor.id, sourceId, tail ?? null, subagent ?? null) };
        } catch (e) {
            // A chat view has no lines, so an unlinked node is one whose canvas it did not name.
            const refusal = e instanceof CodedError && e.code === 'unknown-source' ? await chatViewRefusal(context, actor.id, sourceId) : null;
            throw refusal ?? e;
        }
    }
};
