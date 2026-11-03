import type { ProjectStore } from './project-store.ts';

/*
 * Marks a chat view as one an extension draws in a surface of its own, which takes it out of the sidebar. It stays an
 * ordinary chat in every other way, unlike `hidden`, which is an inline edit's.
 */
export async function markDrawnChat(store: ProjectStore, projectId: string, viewId: string, extensionId: string): Promise<void> {
    await store.mutate(projectId, (content) =>
        content.views.some((view) => view.id === viewId && view.kind === 'chat' && view.drawnBy !== extensionId)
            ? {
                  content: {
                      ...content,
                      views: content.views.map((view) => (view.id === viewId && view.kind === 'chat' ? { ...view, drawnBy: extensionId } : view))
                  },
                  result: undefined
              }
            : { content: null, result: undefined }
    );
}
