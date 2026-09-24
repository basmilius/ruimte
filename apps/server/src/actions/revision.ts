import { ActionRefusal, revisionConflict, type ActionName, type ActionRevisionCheck } from '@ruimte/actions';
import type { ServerActionContext } from './context.ts';

/*
 * The daemon's actions whose document is the project file. The others write a plan, a task, a
 * diagram's own file, a page or a message, none of which has a revision a caller reads first.
 */
export const PROJECT_WRITES: ReadonlySet<ActionName> = new Set<ActionName>([
    'view.create',
    'view.rename',
    'view.setIcon',
    'flag.set',
    'view.move',
    'view.delete',
    'node.create',
    'node.rename',
    'node.delete',
    'node.update',
    'group.create',
    'node.arrange',
    'link.create',
    'link.delete',
    'agent.start',
    'team.start',
    'browser.navigate'
]);

/*
 * Refuses before anything happens, so a start that makes a worktree first makes none. The write
 * itself checks again under the lock (`serverActionCall`), which is what closes the gap in between.
 */
export const checkProjectRevision: ActionRevisionCheck<ServerActionContext> = async (name, _input, call) => {
    if (!PROJECT_WRITES.has(name)) {
        throw new ActionRefusal('no-revision', `${name} writes no project file, so it takes no revision`);
    }
    const current = await call.context.host.revision(call.context.place.projectId);
    if (current !== call.expectedRevision) {
        throw revisionConflict('The project', call.expectedRevision, current);
    }
};
