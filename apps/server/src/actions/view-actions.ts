import { ToolRefusal } from '@adecore/agents/context';
import { ActionRefusal, type ActionHandlers, type ActionOutput } from '@ruimte/actions';
import {
    flagOf,
    isCanvasView,
    isHiddenCanvasView,
    isDividerView,
    isOpenableView,
    isUnknownView,
    sessionNodesOfView,
    withMovedView,
    withRenamedView,
    withView,
    withViewIcon,
    withoutView,
    viewIconOf,
    type NodeTitleSource,
    type ProjectView
} from '@ruimte/contracts';
import { orNote } from '../canvas/host.ts';
import { checkUrl, newId } from '../canvas/nodes.ts';
import { checkPath } from '../canvas/project-paths.ts';
import {
    ID_PREFIX,
    MAX_PROJECT_VIEWS,
    VIEW_KIND_FIELDS,
    deleteReason,
    iconChoice,
    madeView,
    refuseUndeletable,
    storedFilePath,
    viewKindsFor,
    type TableParts,
    viewLines,
    viewNamed
} from '../canvas/views.ts';
import type { ServerActionContext } from './context.ts';
import { databasesOf } from './database-actions.ts';

function kindOf(view: ProjectView): ActionOutput<'view.focus'>['kind'] {
    return isUnknownView(view) ? 'unknown' : view.kind;
}

export const viewActions: ActionHandlers<ServerActionContext> = {
    'view.list': async (_input, { actor, context }) => {
        const revision = await context.host.projects.revision(context.place.projectId);
        const content = await context.host.projects.read(context.place.projectId);
        const anyView = context.host.machine.agentsDeleteAnyView;
        return {
            output: {
                views: content.views
                    .filter((view) => !isHiddenCanvasView(view))
                    .map((view) => {
                        const { may, why } = deleteReason(view, { caller: actor.id, place: context.place, anyView });
                        return {
                            viewId: view.id,
                            kind: kindOf(view),
                            name: view.name ?? '',
                            deletable: may,
                            why,
                            icon: viewIconOf(view)?.value ?? null,
                            flag: flagOf(content.flags, view.id)
                        };
                    }),
                self: context.place.canvasId ?? actor.id,
                revision
            }
        };
    },
    'view.create': async ({ kind, name, url, command, path, provider, after, connection, schema, table, mode, where }, { actor, context }) => {
        // Only `agent_start` starts anything, so a view an agent makes opens empty.
        if (command !== null || provider !== null) {
            throw new ToolRefusal('starts-nothing', 'view_new opens a chat or a terminal empty; agent_start is what starts a CLI');
        }
        if (name === null) {
            throw new ToolRefusal('bad-arguments', 'view_new needs a name');
        }
        // The registry keeps a device view to a person, and no person reaches the daemon's executor.
        if (kind === 'device') {
            throw new ToolRefusal('bad-arguments', 'view_new makes no device view; a person opens one from the devices panel');
        }
        if (kind === 'design') {
            throw new ToolRefusal('bad-arguments', 'view_new makes no design; a person makes one from New view');
        }
        const given = { path, url };
        for (const flag of ['path', 'url'] as const) {
            if (given[flag] !== null && VIEW_KIND_FIELDS[kind] !== flag) {
                throw new ToolRefusal('flag-not-for-kind', `${flag} does not go with a ${kind} view`, [
                    `kind\t${kind}\t${VIEW_KIND_FIELDS[kind] === undefined ? 'takes neither path nor url' : `${VIEW_KIND_FIELDS[kind]} (required)`}`,
                    `field\tpath\t${viewKindsFor('path')}`,
                    `field\turl\t${viewKindsFor('url')}`
                ]);
            }
        }
        const required = VIEW_KIND_FIELDS[kind];
        if (required && given[required] === null) {
            throw new ToolRefusal('missing-flag', `A ${kind} view needs ${required}`, [`kind\t${kind}\t${required} (required)`]);
        }
        const tableFlags = { connection, schema, table, mode, where };
        if (kind !== 'database') {
            const stray = Object.entries(tableFlags).find(([, value]) => value != null);
            if (stray !== undefined) {
                throw new ToolRefusal('flag-not-for-kind', `${stray[0]} does not go with a ${kind} view`, [
                    'kind\tdatabase\tconnection and table (required), schema, mode and where'
                ]);
            }
        } else {
            for (const flag of ['connection', 'table'] as const) {
                if (tableFlags[flag] == null) {
                    throw new ToolRefusal('missing-flag', `A database view needs ${flag}`, ['kind\tdatabase\tconnection and table (required)']);
                }
            }
            if (where != null && mode === 'structure') {
                throw new ToolRefusal('bad-arguments', 'where filters rows, so it goes with mode data and not with mode structure');
            }
        }

        // The disk is read before the lock, so a slow folder holds up nobody else's save.
        const folder = context.place.folder;
        const checkedUrl = url === null ? undefined : checkUrl(url);
        const checkedPath = path === null ? undefined : await checkPath(folder, path);
        const shownTable: TableParts | undefined =
            kind === 'database'
                ? {
                      ...(await databasesOf(context).tableOf(context.place, connection!, schema ?? null)),
                      table: table!,
                      mode: mode ?? 'data',
                      ...(where == null ? {} : { where })
                  }
                : undefined;

        return context.host.projects.mutate(context.place.projectId, (content) => {
            if (content.views.length + 1 > MAX_PROJECT_VIEWS) {
                throw new ToolRefusal('too-many-views', `This project has ${content.views.length} views and a project holds at most ${MAX_PROJECT_VIEWS}`);
            }
            if (after != null) {
                viewNamed(content, after, 'after');
            }
            const id = newId(ID_PREFIX[kind] ?? 'view', content);
            const view = madeView(kind, id, name, actor.id, {
                url: checkedUrl,
                path: checkedPath === undefined ? undefined : storedFilePath(folder, checkedPath),
                table: shownTable
            });
            return {
                content: { ...content, views: withView(content.views, view, after ?? undefined) },
                result: { output: { viewId: id, view: name, kind } }
            };
        });
    },
    'view.rename': async ({ viewId, name }, { context }) => {
        const { host, place } = context;
        return host.projects.mutate(place.projectId, (content) => {
            const view = viewNamed(content, viewId, 'view rename');
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
                                  await host.projects.mutate(place.projectId, (current) => {
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
    },
    'view.setIcon': async ({ viewId, icon: name }, { context }) => {
        const icon = name === null ? null : iconChoice(name);
        return context.host.projects.mutate(context.place.projectId, (content) => {
            const view = viewNamed(content, viewId, 'view icon');
            if (isDividerView(view)) {
                throw new ToolRefusal('not-markable', `${viewId} is a ${view.kind}, a row that divides the sidebar and has no room for a mark`);
            }
            const views = withViewIcon(content.views, viewId, icon);
            return {
                content: views === null ? null : { ...content, views },
                result: { output: { viewId, kind: kindOf(view), icon: icon === null ? null : { kind: 'lucide' as const, value: icon.value } } }
            };
        });
    },
    'view.move': async ({ viewId, afterViewId }, { context }) =>
        context.host.projects.mutate(context.place.projectId, (content) => {
            const view = viewNamed(content, viewId, 'view move');
            let toIndex = 0;
            if (afterViewId !== null) {
                const after = viewNamed(content, afterViewId, 'after');
                if (after.id === viewId) {
                    throw new ToolRefusal('two-places', 'view move cannot put a view under itself');
                }
                // The index is read off the list without the view, since that is where it is put back.
                toIndex = content.views.filter((candidate) => candidate.id !== viewId).findIndex((candidate) => candidate.id === after.id) + 1;
            }
            const views = withMovedView(content.views, viewId, toIndex);
            return {
                content: views === null ? null : { ...content, views },
                result: { output: { viewId, kind: kindOf(view), index: (views ?? content.views).findIndex((candidate) => candidate.id === viewId) } }
            };
        }),
    'view.delete': async ({ viewId }, { actor, context }) => {
        const { host, place } = context;
        const anyView = host.machine.agentsDeleteAnyView;
        return host.projects.mutate(place.projectId, async (content) => {
            const view = viewNamed(content, viewId, 'view delete');
            refuseUndeletable(view, { caller: actor.id, place, anyView });
            const result = withoutView(content.views, viewId)!;
            const sessions = sessionNodesOfView(view);
            /* The sessions go before the write, the rule a project closing follows: a shell that
               outlived the canvas it stood on would answer to a node nothing draws any more. */
            for (const node of sessions) {
                await host.endSession(node.kind, node.id);
            }
            return {
                content: { ...content, views: result.views },
                result: {
                    output: {
                        viewId,
                        view: view.name ?? '',
                        kind: kindOf(view),
                        ended: sessions.map((node) => ({ nodeId: node.id, kind: node.kind })),
                        nodes: isCanvasView(view) ? view.nodes.map((node) => ({ nodeId: node.id, kind: node.kind, title: node.title })) : []
                    }
                }
            };
        });
    },
    'view.focus': async ({ viewId }, { actor, context }) => {
        const content = await context.host.projects.read(context.place.projectId);
        // Only what view open itself takes: a refusal that listed the dividers would offer what the next call refuses.
        const openable = (): string[] => orNote(viewLines(content.views.filter(isOpenableView)), 'This project has no view that opens');
        const view = content.views.find((candidate) => candidate.id === viewId);
        if (!view) {
            throw new ToolRefusal('unknown-view', `${viewId} is not a view of this project`, [...openable(), 'note\tview open takes a view id, never a name']);
        }
        if (!isOpenableView(view)) {
            throw new ToolRefusal('never-opens', `${viewId} is a ${view.kind} and has nothing to show`, openable());
        }
        const delivered = context.host.projects.showView(context.place.projectId, viewId, actor.id);
        return { output: { viewId, view: view.name ?? viewId, kind: kindOf(view), changed: delivered, delivered } };
    }
};
