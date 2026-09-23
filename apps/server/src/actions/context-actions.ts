import type { ActionHandlers } from '@ruimte/actions';
import { VerbRefusal, type ContextHost } from '../canvas/verb.ts';
import type { ServerActionContext } from './context.ts';

const contextOf = (context: ServerActionContext): ContextHost => {
    if (!context.host.context) {
        throw new VerbRefusal('no-context', 'This machine keeps no linked context');
    }
    return context.host.context;
};

/* What a person linked into the caller: only a line it sits on, or the frame of a group, makes a source readable. */
export const contextActions: ActionHandlers<ServerActionContext> = {
    'context.list': (_input, { actor, context }) => ({ output: { sources: contextOf(context).list(actor.id) } }),
    'context.read': async ({ sourceId, tail, subagent }, { actor, context }) => ({
        output: { text: await contextOf(context).read(actor.id, sourceId, tail ?? null, subagent ?? null) }
    })
};
