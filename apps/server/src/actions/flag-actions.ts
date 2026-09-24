import type { ActionHandlers } from '@ruimte/actions';
import { flagOf, isCanvasView, withFlags, type ProjectContent } from '@ruimte/contracts';
import { VerbRefusal } from '../canvas/verb.ts';
import { viewLines } from '../canvas/views.ts';
import type { ServerActionContext } from './context.ts';

/* Whether an id names a view or a node of this project; a view id and a node id are one namespace. */
const targetOf = (content: ProjectContent, id: string): 'view' | 'node' => {
    if (content.views.some((view) => view.id === id)) {
        return 'view';
    }
    if (content.views.some((view) => isCanvasView(view) && view.nodes.some((node) => node.id === id))) {
        return 'node';
    }
    throw new VerbRefusal('unknown-target', `${id} is not a view or a node of this project`, [
        ...viewLines(content.views),
        'note\tflag takes an id, never a name; ruimte-context node list lists the nodes of a canvas'
    ]);
};

export const flagActions: ActionHandlers<ServerActionContext> = {
    'flag.set': async ({ ids, color }, { context }) =>
        context.host.mutate(context.place.projectId, (content) => {
            const flagged = [...new Set(ids)].map((id) => ({ id, target: targetOf(content, id), previous: flagOf(content.flags, id) }));
            const flags = withFlags(content.flags, ids, color);
            return {
                content: flags === null ? null : { ...content, flags },
                result: { output: { flags: flagged, color, changed: flags !== null } }
            };
        })
};
