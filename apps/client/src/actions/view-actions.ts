import { ActionRefusal, type ActionHandlers } from '@ruimte/actions';
import {
    canShareView,
    flagOf,
    isCanvasView,
    isChatHostView,
    isDiagramView,
    isDrawingView,
    isOpenableView,
    isProjectIconName,
    isSessionView,
    isUnknownView,
    MAIN_VIEW_NAME,
    type DeviceReference,
    type NodeTitleSource,
    type ProjectDatabaseTarget,
    type ProjectIconChoice,
    type ProjectCanvasView,
    type ProjectView,
    type ProviderInfo,
    viewIconOf,
    nodeChats
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { databaseViewName } from '@/database/view-name';
import { databaseViewShareRefusal } from '@/database/view-sharing';
import { addAgentView, addDesignView } from '@/agents/nodes';
import { freeDesignFolder } from '@/design/design-folder';
import { saveViewFiles, viewDeletionFacts, type ViewDeletionMachine } from '@/project/view-deletion';
import { nodesOfView } from '@/project/view-nodes';
import { offerViewUndo } from '@/project/view-trash';
import { basenameOf } from '@/shell/panels/files-tree';
import { locateView } from '@/shell/split';
import { canvasInReach } from '@/state/canvas-target';
import type { DocumentState } from '@/state/document';
import {
    agentFor,
    canvasNow,
    canvasOnScreen,
    centerWorld,
    deletionConsequences,
    existingView,
    hasNode,
    historyUndo,
    kindOf,
    quoted,
    refuseResumeWithout,
    refuseUnreachableBrowser,
    sessionOf,
    sessionsEnded,
    storedFilePath,
    unknownCanvas,
    unknownView,
    type CreatableViewKind
} from '@/actions/action-reach';

/* What the view actions reach outside the document; a test hands in a fake of each. */
export interface ViewReach {
    /* The agent CLIs of the machine the project runs on. */
    providers(): readonly ProviderInfo[];
    viewDeletion: ViewDeletionMachine;
    /* A drawing or diagram keeps what it holds in a file of its own, which the daemon copies. */
    copyViewContent(kind: 'drawing' | 'diagram', from: string, to: string): void;
    /* The folders under `designs/` of the project on disk, as stored paths. */
    designFolders(): Promise<readonly string[]>;
}

const VIEW_BASE_NAMES: Record<CreatableViewKind, string> = {
    canvas: MAIN_VIEW_NAME,
    drawing: 'Drawing',
    diagram: 'Diagram',
    terminal: 'Terminal',
    browser: 'Browser',
    chat: 'AI Chat',
    file: 'File',
    database: 'Table',
    separator: 'Separator',
    subheader: 'Section',
    device: 'Device',
    design: 'Design'
};

/* A new view is named after what it is, "Canvas", then "Canvas 2", until someone renames it. */
export function freeName(views: readonly ProjectView[], base: string): string {
    const taken = new Set(views.flatMap((view) => (view.name === undefined ? [] : [view.name])));
    if (!taken.has(base)) {
        return base;
    }
    let counter = 2;
    while (taken.has(`${base} ${counter}`)) {
        counter += 1;
    }
    return `${base} ${counter}`;
}

/* What a view is called when nobody named it: what it shows, else what it is. */
function derivedViewName(
    state: DocumentState,
    kind: CreatableViewKind,
    { url, path, device, table }: { url: string | null; path: string | null; device: DeviceReference | null | undefined; table: ProjectDatabaseTarget | null }
): string {
    if (kind === 'file' && path !== null) {
        return basenameOf(path);
    }
    if (kind === 'database' && table !== null) {
        return databaseViewName(table);
    }
    if (kind === 'browser' && url !== null) {
        return url;
    }
    if (kind === 'device' && device != null) {
        return device.name;
    }
    return freeName(state.views, VIEW_BASE_NAMES[kind]);
}

function namedCanvas(state: DocumentState, canvasViewId: string): ProjectCanvasView {
    const named = state.views.find((view) => view.id === canvasViewId);
    if (!named) {
        throw unknownCanvas(canvasViewId);
    }
    if (!isCanvasView(named)) {
        throw new ActionRefusal('not-a-canvas', `“${named.name ?? canvasViewId}” is a ${named.kind} view, not a canvas.`);
    }
    return named;
}

/* A view of a kind that runs no agent, under the name it was given. */
function addViewOf(
    state: DocumentState,
    kind: CreatableViewKind,
    title: string,
    {
        url,
        browserOwner,
        command,
        path,
        device,
        cwd,
        table
    }: {
        url: string | null;
        browserOwner?: string | null;
        command: string | null;
        path: string | null;
        device: DeviceReference | null;
        cwd: string | null;
        table: ProjectDatabaseTarget | null;
    }
): string {
    const folder = cwd === null ? {} : { cwd };
    switch (kind) {
        case 'canvas':
            return state.addCanvasView(title);
        case 'drawing':
            return state.addDrawingView(title);
        case 'diagram':
            return state.addDiagramView(title);
        case 'separator':
            return state.addSeparatorView();
        case 'subheader':
            return state.addSubheaderView(title);
        case 'file':
            if (path === null) {
                throw new ActionRefusal('missing-path', 'Name the file a file view shows.');
            }
            return state.addFileView(title, storedFilePath(path));
        case 'database':
            if (table === null) {
                throw new ActionRefusal('missing-table', 'Name the connection, the schema and the table a database view shows.');
            }
            return state.addDatabaseView(title, table);
        case 'browser':
            return state.addStandaloneView({ kind, name: title, url: url ?? 'https://www.google.com', ...(browserOwner ? { browserOwner } : {}) });
        case 'chat':
            return state.addStandaloneView({ kind, name: title, node: folder });
        case 'terminal':
            return state.addStandaloneView({ kind, name: title, node: command ? { command, ...folder } : folder });
        case 'device':
            if (device === null) {
                throw new ActionRefusal('missing-device', 'Name the device a device view shows.');
            }
            return state.addStandaloneView({ kind, name: title, device });
        case 'design':
            throw new ActionRefusal('missing-provider', 'A design is worked on by an AI chat. Name its provider.');
    }
}

/* The views of the project: shown, named, made, deleted, copied, moved, marked, shared and flagged. */
export function viewActions(document: StoreApi<DocumentState>, reach: ViewReach): ActionHandlers<void> {
    const { providers, viewDeletion, copyViewContent, designFolders } = reach;
    return {
        'view.focus': ({ viewId }) => {
            const state = document.getState();
            const view = existingView(state, viewId);
            if (!isOpenableView(view)) {
                throw new ActionRefusal('never-opens', `“${view.name}” is a ${view.kind} and cannot be focused.`);
            }
            const previousViewId = state.activeViewId;
            const shown = state.showView(viewId);
            return {
                output: {
                    viewId,
                    view: view.name ?? viewId,
                    kind: kindOf(view),
                    changed: document.getState().activeViewId !== previousViewId
                },
                ...(shown ? { undo: () => document.getState().undoShowView(shown) } : {})
            };
        },
        'view.rename': ({ viewId, name }) => {
            const state = document.getState();
            const view = existingView(state, viewId);
            if (isUnknownView(view)) {
                throw new ActionRefusal('unsupported-view', `The view “${view.name}” has a kind this version of Ruimte cannot rename.`);
            }
            const previousName = view.name ?? '';
            const previousSource: NodeTitleSource | null = 'titleSource' in view ? (view.titleSource ?? null) : null;
            state.renameView(viewId, name);
            const changed = document.getState().edits !== state.edits;
            return {
                output: {
                    viewId,
                    kind: kindOf(view),
                    previousName,
                    name,
                    changed
                },
                ...(changed
                    ? {
                          undo: () => {
                              const current = document.getState().views.find((candidate) => candidate.id === viewId);
                              const currentSource = current && 'titleSource' in current ? (current.titleSource ?? null) : null;
                              if (!current || current.name !== name || currentSource !== 'user') {
                                  throw new ActionRefusal('stale-undo', `“${name}” is no longer the current name of this view.`);
                              }
                              document.getState().renameView(viewId, previousName, previousSource);
                          }
                      }
                    : {})
            };
        },
        'view.create': async ({
            kind,
            name,
            url,
            browserOwner,
            command,
            path,
            provider,
            account,
            device,
            resume,
            cwd,
            connection,
            schema,
            table,
            mode,
            where
        }) => {
            refuseUnreachableBrowser(kind, url, browserOwner);
            refuseResumeWithout(resume, provider);
            if (kind === 'design') {
                const agent = agentFor(providers(), 'chat', provider, null, account ?? null);
                if (agent === null) {
                    throw new ActionRefusal('missing-provider', 'A design is worked on by an AI chat. Name its provider.');
                }
                // Read before the document, since the list may change while the disk answers.
                const onDisk = path === null ? await designFolders() : [];
                const state = document.getState();
                const title = name ?? freeName(state.views, VIEW_BASE_NAMES.design);
                const folder = path === null ? freeDesignFolder(state.views, title, onDisk) : storedFilePath(path);
                const viewId = addDesignView(agent.info, title, folder, { ...(cwd == null ? {} : { cwd }), ...(account == null ? {} : { account }) });
                if (!viewId) {
                    throw new ActionRefusal('view-create-failed', 'Ruimte could not create the design.');
                }

                return { output: { viewId, view: title, kind } };
            }
            const agent = agentFor(providers(), kind, provider, command);
            if (account != null && agent === null) {
                throw new ActionRefusal('missing-provider', 'An account belongs to an agent CLI. Name the provider as well.');
            }
            const state = document.getState();
            const shown: ProjectDatabaseTarget | null =
                connection != null && schema != null && table != null
                    ? { connectionId: connection, schema, table, mode: mode ?? 'data', ...(where == null ? {} : { where }) }
                    : null;
            const title =
                kind === 'separator'
                    ? VIEW_BASE_NAMES.separator
                    : (name ?? agent?.info.name ?? derivedViewName(state, kind, { url, path, device, table: shown }));
            const viewId =
                agent === null
                    ? addViewOf(state, kind, title, { url, browserOwner, command, path, device: device ?? null, cwd: cwd ?? null, table: shown })
                    : addAgentView(agent.target, agent.info, title, { ...sessionOf(resume, cwd), ...(account == null ? {} : { account }) });
            if (!viewId) {
                throw new ActionRefusal('view-create-failed', `Ruimte could not create the ${kind} view.`);
            }
            return {
                output: {
                    viewId,
                    view: document.getState().views.find((view) => view.id === viewId)?.name ?? title,
                    kind
                }
            };
        },
        'view.delete': async ({ viewId }, { confirmed, actor }) => {
            const exported = () =>
                document
                    .getState()
                    .exportViews()
                    .find((candidate) => candidate.id === viewId);
            const view = exported();
            if (!view) {
                throw unknownView(viewId);
            }
            if (!confirmed) {
                const nodes = nodesOfView(view).length;
                const sessions = isCanvasView(view)
                    ? nodesOfView(view).reduce((count, node) => count + (node.kind === 'terminal' ? 1 : nodeChats(node).length), 0)
                    : isChatHostView(view) || view.kind === 'terminal'
                      ? 1
                      : 0;
                const facts = await viewDeletionFacts(view, document.getState().exportViews(), viewDeletion);
                return {
                    confirmation: {
                        title: `Delete “${view.name}”?`,
                        consequences: [
                            nodes === 0 ? 'The view will be removed.' : `The view and its ${nodes} ${nodes === 1 ? 'node' : 'nodes'} will be removed.`,
                            ...sessionsEnded(sessions),
                            ...deletionConsequences(facts, 'this view')
                        ]
                    }
                };
            }
            const unsaved = await saveViewFiles(view, viewDeletion);
            if (unsaved.length > 0) {
                throw new ActionRefusal('unsaved-files', `${quoted(unsaved.map(basenameOf))} could not be saved, so “${view.name}” was kept.`);
            }
            // Saving waits on the machine, and the view may have gone in the meantime.
            if (!exported()) {
                throw new ActionRefusal('unknown-view', `“${view.name}” is no longer in this project.`);
            }
            const output = { viewId, view: view.name ?? viewId, kind: kindOf(view) };
            if (actor.kind !== 'person') {
                document.getState().deleteView(viewId);
                return { output };
            }
            // A person gets a way back instead of a question, so nothing on the view ends until that offer does.
            document.getState().trashView(viewId);
            offerViewUndo(document, viewId, output.view);
            return {
                output,
                undo: () => {
                    if (!document.getState().restoreView(viewId)) {
                        throw new ActionRefusal('stale-undo', `“${output.view}” can no longer be brought back.`);
                    }
                }
            };
        },
        'view.duplicate': ({ viewId }) => {
            const state = document.getState();
            const source = existingView(state, viewId);
            if (!isCanvasView(source) && !isDrawingView(source) && !isDiagramView(source)) {
                throw new ActionRefusal(
                    'view-not-duplicable',
                    `“${source.name}” is a ${source.kind} view; only a canvas, drawing or diagram can be duplicated.`
                );
            }
            const copyId = state.duplicateView(viewId);
            const copied = () =>
                document
                    .getState()
                    .exportViews()
                    .find((candidate) => candidate.id === copyId);
            const copy = copied();
            if (!copyId || !copy) {
                throw new ActionRefusal('view-duplicate-failed', `Ruimte could not duplicate “${source.name}”.`);
            }
            if (isDrawingView(source) || isDiagramView(source)) {
                copyViewContent(source.kind, viewId, copyId);
            }
            const written = JSON.stringify(copy);
            return {
                output: { sourceViewId: viewId, viewId: copyId, view: copy.name ?? copyId, kind: kindOf(copy) },
                undo: () => {
                    const current = document.getState();
                    // A copy someone opened may hold work by now, so only one nobody touched goes again.
                    const opened = current.viewLocal[copyId] !== undefined || (current.layout !== null && locateView(current.layout, copyId) !== null);
                    if (opened || JSON.stringify(copied()) !== written) {
                        throw new ActionRefusal('stale-undo', `“${copy.name}” was opened or changed after this action, so it is kept.`);
                    }
                    current.deleteView(copyId);
                }
            };
        },
        'view.placeOnCanvas': ({ viewId, canvasViewId }) => {
            const state = document.getState();
            const view = existingView(state, viewId);
            if (!isSessionView(view)) {
                throw new ActionRefusal(
                    'view-not-placeable',
                    `“${view.name}” is a ${view.kind} view; only a chat, terminal, browser or device view becomes a node.`
                );
            }
            const target = canvasViewId == null ? canvasInReach(state) : namedCanvas(state, canvasViewId);
            if (target === null) {
                throw new ActionRefusal('no-canvas', 'This project has no canvas to place the view on.');
            }
            if (!state.putOnCanvas(viewId, target.id)) {
                throw new ActionRefusal('view-place-failed', `Ruimte could not place “${view.name}” on “${target.name}”.`);
            }
            return {
                output: { viewId, view: view.name, canvasViewId: target.id, canvas: target.name },
                undo: () => {
                    const current = document.getState();
                    const canvasView = current.exportViews().find((candidate) => candidate.id === target.id);
                    const standing = canvasView !== undefined && isCanvasView(canvasView) && canvasView.nodes.some((node) => node.id === viewId);
                    // Lines drawn to it since would be lost on the way back.
                    const drawnTo =
                        canvasView !== undefined && isCanvasView(canvasView) && canvasView.edges.some((edge) => edge.from === viewId || edge.to === viewId);
                    if (!standing || drawnTo) {
                        throw new ActionRefusal('stale-undo', `“${view.name}” is no longer on “${target.name}” as it was placed.`);
                    }
                    current.openAsView(viewId);
                }
            };
        },
        'view.showOnCanvas': ({ viewId }) => {
            const state = document.getState();
            const view = existingView(state, viewId);
            if (!isDrawingView(view) && !isDiagramView(view)) {
                throw new ActionRefusal('view-not-mirrorable', `“${view.name}” is a ${view.kind} view; only a drawing or diagram is shown on a canvas.`);
            }
            const target = canvasInReach(state);
            if (target === null) {
                throw new ActionRefusal('no-canvas', 'This project has no canvas to show the view on.');
            }
            state.showView(target.id);
            const { canvas } = canvasOnScreen(document, target.id);
            const depth = canvas.past.length;
            const nodeId = canvas.addNode(view.kind, centerWorld(canvas), { title: view.name, viewId });
            if (nodeId === null) {
                throw new ActionRefusal('node-create-failed', `Ruimte could not show “${view.name}” on “${target.name}”.`);
            }
            canvasNow(document, target.id).goToNode(nodeId);
            return {
                output: { viewId, view: view.name, canvasViewId: target.id, canvas: target.name, nodeId },
                undo: historyUndo(target.id, depth + 1, hasNode(nodeId))
            };
        },
        'view.share': ({ viewId, shared }) => {
            const state = document.getState();
            const view = existingView(state, viewId);
            if (shared && (!canShareView(view) || databaseViewShareRefusal(view) !== null)) {
                throw new ActionRefusal('view-not-shareable', `“${view.name ?? viewId}” cannot go in the shared file.`);
            }
            const changed = state.shared.includes(viewId) !== shared;
            if (changed) {
                state.setShared(viewId, shared);
            }
            return {
                output: { viewId, view: view.name ?? '', shared, changed },
                ...(changed
                    ? {
                          undo: () => {
                              const current = document.getState();
                              if (current.shared.includes(viewId) !== shared) {
                                  throw new ActionRefusal('stale-undo', `“${view.name ?? viewId}” was moved between the files again after this action.`);
                              }
                              current.setShared(viewId, !shared);
                          }
                      }
                    : {})
            };
        },
        'view.move': ({ viewId, afterViewId }) => {
            const state = document.getState();
            const view = existingView(state, viewId);
            let toIndex = 0;
            if (afterViewId !== null) {
                if (afterViewId === viewId) {
                    throw new ActionRefusal('two-places', 'A view cannot go right under itself.');
                }
                // Read off the list without the view, since that is where it is put back.
                const after = state.views.filter((candidate) => candidate.id !== viewId).findIndex((candidate) => candidate.id === afterViewId);
                if (after === -1) {
                    throw unknownView(afterViewId);
                }
                toIndex = after + 1;
            }
            const from = state.views.findIndex((candidate) => candidate.id === viewId);
            state.moveView(viewId, toIndex);
            const index = document.getState().views.findIndex((candidate) => candidate.id === viewId);
            return {
                output: { viewId, kind: kindOf(view), index },
                ...(index === from
                    ? {}
                    : {
                          undo: () => {
                              const current = document.getState();
                              if (current.views.findIndex((candidate) => candidate.id === viewId) !== index) {
                                  throw new ActionRefusal('stale-undo', `“${view.name ?? viewId}” moved again since.`);
                              }
                              current.moveView(viewId, from);
                          }
                      })
            };
        },
        'view.setIcon': ({ viewId, icon }) => {
            const state = document.getState();
            const view = existingView(state, viewId);
            if (!isOpenableView(view) || isUnknownView(view)) {
                throw new ActionRefusal('not-markable', `“${view.name ?? viewId}” divides the sidebar and has no room for a mark.`);
            }
            if (icon !== null && !isProjectIconName(icon)) {
                throw new ActionRefusal('unknown-icon', `“${icon}” is not one of the Lucide names the picker has.`);
            }
            const previous = viewIconOf(view);
            const next: ProjectIconChoice | null = icon === null ? null : { kind: 'lucide', value: icon };
            state.setViewIcon(viewId, next);
            const iconOf = (): ProjectIconChoice | null => {
                const current = document.getState().views.find((candidate) => candidate.id === viewId);
                return current ? viewIconOf(current) : null;
            };
            return {
                output: { viewId, kind: kindOf(view), icon: next },
                undo: () => {
                    if (iconOf()?.value !== next?.value) {
                        throw new ActionRefusal('stale-undo', `The mark of “${view.name ?? viewId}” changed again since.`);
                    }
                    document.getState().setViewIcon(viewId, previous);
                }
            };
        },
        'flag.set': ({ ids, color }) => {
            const state = document.getState();
            const flagged = [...new Set(ids)].map((id) => {
                const target = state.views.some((view) => view.id === id)
                    ? ('view' as const)
                    : state.views.some((view) => nodesOfView(view).some((node) => node.id === id))
                      ? ('node' as const)
                      : null;
                if (target === null) {
                    throw new ActionRefusal('unknown-target', `No view or node with id “${id}” exists in this project.`);
                }
                return { id, target, previous: flagOf(state.flags, id) };
            });
            state.setFlags(ids, color);
            const changed = document.getState().flags !== state.flags;
            return {
                output: { flags: flagged, color, changed },
                ...(changed
                    ? {
                          undo: () => {
                              const current = document.getState();
                              if (flagged.some((entry) => flagOf(current.flags, entry.id) !== color)) {
                                  throw new ActionRefusal('stale-undo', 'These flags changed again since.');
                              }
                              for (const entry of flagged) {
                                  current.setFlags([entry.id], entry.previous);
                              }
                          }
                      }
                    : {})
            };
        }
    };
}
