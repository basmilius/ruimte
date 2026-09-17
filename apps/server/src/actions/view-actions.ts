import { ActionRefusal, ActionRegistry, type ActionCall, type ActionOutput } from '@ruimte/actions';
import { isOpenableView, isUnknownView, withRenamedView, type NodeTitleSource, type ProjectView } from '@ruimte/contracts';
import type { CanvasHost } from '../canvas/verb.ts';

interface ServerActionContext {
    host: CanvasHost;
    projectId: string;
}

const kindOf = (view: ProjectView): ActionOutput<'view.focus'>['kind'] => (isUnknownView(view) ? 'unknown' : view.kind);

export const serverViewActions = new ActionRegistry<ServerActionContext>({
    'view.focus': async ({ viewId }, { actor, context }) => {
        const content = await context.host.read(context.projectId);
        const view = content.views.find((candidate) => candidate.id === viewId);
        if (!view) {
            throw new ActionRefusal('unknown-view', `${viewId} is not a view of this project`);
        }
        if (!isOpenableView(view)) {
            throw new ActionRefusal('view-not-openable', `${viewId} is a separator, a line in the sidebar with nothing to show`);
        }
        const delivered = context.host.showView(context.projectId, viewId, actor.id);
        return { output: { viewId, view: view.name ?? viewId, kind: kindOf(view), changed: delivered, delivered } };
    },
    'view.rename': async ({ viewId, name }, { context }) => {
        return context.host.mutate(context.projectId, (content) => {
            const view = content.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw new ActionRefusal('unknown-view', `${viewId} is not a view of this project`);
            }
            const previousName = view.name ?? '';
            const previousSource: NodeTitleSource | null = 'titleSource' in view ? (view.titleSource ?? null) : null;
            const views = withRenamedView(content.views, viewId, name);
            const output = { viewId, kind: kindOf(view), previousName, name, changed: views !== null };
            return {
                content: views === null ? null : { ...content, views },
                result: {
                    output,
                    ...(views === null
                        ? {}
                        : {
                              undo: async () => {
                                  await context.host.mutate(context.projectId, (current) => {
                                      const currentView = current.views.find((candidate) => candidate.id === viewId);
                                      const currentSource = currentView && 'titleSource' in currentView ? (currentView.titleSource ?? null) : null;
                                      if (!currentView || currentView.name !== name || currentSource !== 'user') {
                                          throw new ActionRefusal('stale-undo', `${name} is no longer the current name of this view`);
                                      }
                                      const restored = withRenamedView(current.views, viewId, previousName, previousSource);
                                      return { content: restored === null ? null : { ...current, views: restored }, result: undefined };
                                  });
                              }
                          })
                }
            };
        });
    }
});

export const serverActionCall = (host: CanvasHost, projectId: string, actorId: string): ActionCall<ServerActionContext> => ({
    actor: { kind: 'agent', id: actorId },
    context: { host, projectId }
});
