import type { ActionHandlers } from '@ruimte/actions';
import { CodedError } from '@adecore/agents';
import { canvasContextSources, isHiddenCanvasView, type ContextSource } from '@ruimte/contracts';
import { resolveReference, type Reference } from '../context/references.ts';
import { arrangedCanvas, canvasHolding, isChatView, notOnView, viewRequired } from '../canvas/chat-view.ts';
import { VerbRefusal, snoozedAt, type ContextHost } from '../canvas/verb.ts';
import { refuseOtherMachine } from '../canvas/remote-node.ts';
import { ContextRefusal } from '../context/context-store.ts';
import { readInForm, readReference } from '../context/read-forms.ts';
import { hostService, type ServerActionContext } from './context.ts';

function contextOf(context: ServerActionContext): ContextHost {
    return hostService(context, 'context', 'no-context', 'This machine keeps no linked context');
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

/*
 * What an id names in the other project `--project` reached, read without a line: a person opened every
 * open project to agents with the switch, as a `#` opens one canvas. Another machine's canvas stays out.
 */
async function reachedReference({ host, place }: ServerActionContext, sourceId: string): Promise<Reference> {
    const content = await host.projects.read(place.projectId);
    const views = content.views.filter((view) => !isHiddenCanvasView(view));
    const reference = resolveReference(views, sourceId, place.folder);
    if (reference === null) {
        throw new ContextRefusal('unknown-source', `${sourceId} is no view, node or text of ${place.projectId}`);
    }

    return reference;
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
    'context.read': async ({ sourceId, tail, subagent, viewId, form }, { actor, context }) => {
        const store = contextOf(context);
        refuseOtherMachine(context.host, sourceId);
        if (context.origin !== undefined) {
            if (viewId != null) {
                throw new VerbRefusal('bad-arguments', '--project reads every node of that project without --view; leave --view out');
            }
            const reached = await reachedReference(context, sourceId);
            if (reached.kind === 'canvas' || reached.kind === 'database') {
                return { output: await readReference(context, actor.id, reached, form ?? null) };
            }
            const source = reached.sources.find((candidate) => candidate.id === sourceId || candidate.nodeId === sourceId) ?? reached.sources[0];
            if (source === undefined) {
                throw new ContextRefusal('unreadable', `${sourceId} is in ${context.place.projectId}, but it holds nothing to read`);
            }
            if (form != null) {
                return { output: await readInForm(context, actor.id, source, form) };
            }
            return { output: await store.answerSource(actor.id, source, tail ?? null, subagent ?? null, context.place.projectId) };
        }
        const whole = store
            .referenced?.(actor.id)
            .find((reference) => reference.id === sourceId && (reference.kind === 'canvas' || reference.kind === 'database'));
        if (whole) {
            return { output: await readReference(context, actor.id, whole, form ?? null) };
        }
        const arranged = viewId == null ? null : await arrangedSource(context, actor.id, sourceId, viewId);
        if (form != null) {
            const source = arranged ?? store.sourceFor?.(actor.id, sourceId) ?? null;
            if (source === null) {
                // The read whole says why this id is not the caller's to read, which holds for every form of it.
                await store.answer(actor.id, sourceId, null, null);
                throw new ContextRefusal('unknown-source', `${sourceId} is not linked to you`);
            }
            return { output: await readInForm(context, actor.id, source, form) };
        }
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
