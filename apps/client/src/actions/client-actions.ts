import { ActionRefusal, ActionRegistry, type ActionCall, type ActionOutput } from '@ruimte/actions';
import { isCanvasView, isOpenableView, isUnknownNode, isUnknownView, type NodeTitleSource, type ProjectNode, type ProjectView } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { intersects, toWorld, visibleRect } from '@/canvas/math';
import { nearestFreeNodeRect } from '@/canvas/place-node';
import { focusedCanvas, NODE_SIZE, type CanvasState, type NodeKind } from '@/state/canvas';
import { activeViewOf, useDocument, type DocumentState } from '@/state/document';
import { useProject } from '@/state/project';
import { chatClient } from '@/transport/connections';

const kindOf = (view: ProjectView): ActionOutput<'view.focus'>['kind'] => (isUnknownView(view) ? 'unknown' : view.kind);
const kindOfNode = (node: ProjectNode): ActionOutput<'node.focus'>['kind'] => (isUnknownNode(node) ? 'unknown' : node.kind);

const activeCanvas = (document: StoreApi<DocumentState>, viewId: string): { view: ProjectView & { kind: 'canvas' }; canvas: CanvasState } => {
    const view = activeViewOf(document.getState());
    if (!view || !isCanvasView(view) || view.id !== viewId) {
        throw new ActionRefusal('inactive-canvas', 'Open the target canvas before changing its nodes.');
    }
    return { view, canvas: focusedCanvas().getState() };
};

const freeViewName = (document: StoreApi<DocumentState>, base: string): string => {
    const names = new Set(document.getState().views.map((view) => view.name));
    if (!names.has(base)) {
        return base;
    }
    let index = 2;
    while (names.has(`${base} ${index}`)) {
        index += 1;
    }
    return `${base} ${index}`;
};

const centerWorld = (canvas: CanvasState) =>
    toWorld(canvas.camera, {
        x: canvas.viewport.w / 2,
        y: canvas.viewport.h / 2
    });

const addNodeInFreeSpace = (canvas: CanvasState, kind: NodeKind, options: Parameters<CanvasState['addNode']>[2]): string | null => {
    const placed = nearestFreeNodeRect(Object.values(canvas.nodes), NODE_SIZE[kind], centerWorld(canvas));
    return canvas.addNode(kind, { x: placed.x + placed.w / 2, y: placed.y + placed.h / 2 }, options);
};

const historyUndo = (viewId: string, expectedDepth: number, expectedNodeId?: string) => () => {
    const current = activeCanvas(useDocument, viewId).canvas;
    if (current.past.length !== expectedDepth || (expectedNodeId && !current.nodes[expectedNodeId])) {
        throw new ActionRefusal('stale-undo', 'The canvas changed after this action, so it cannot be safely undone here.');
    }
    current.undo();
};

const chatTitle = (document: StoreApi<DocumentState>, chatId: string): string | null => {
    const active = activeViewOf(document.getState());
    const live = active && isCanvasView(active) ? focusedCanvas().getState().nodes[chatId] : undefined;
    if (live?.kind === 'chat') {
        return live.title;
    }
    for (const view of document.getState().views) {
        if (view.kind === 'chat' && view.id === chatId) {
            return view.name;
        }
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === chatId && candidate.kind === 'chat');
            if (node) {
                return node.title;
            }
        }
    }
    return null;
};

export const createClientActionRegistry = (document: StoreApi<DocumentState>): ActionRegistry<void> =>
    new ActionRegistry<void>({
        'workspace.inspect': () => {
            const state = document.getState();
            const active = activeViewOf(state);
            const current = active && isCanvasView(active) ? focusedCanvas().getState() : null;
            const viewport = current ? visibleRect(current.camera, current.viewport) : null;
            return {
                output: {
                    project: useProject.getState().current?.name ?? 'Untitled project',
                    activeView: active
                        ? {
                              id: active.id,
                              name: active.name ?? active.id,
                              kind: kindOf(active)
                          }
                        : null,
                    views: state.views.filter(isOpenableView).map((view) => ({
                        id: view.id,
                        name: view.name ?? view.id,
                        kind: kindOf(view)
                    })),
                    canvas:
                        active && current
                            ? {
                                  viewId: active.id,
                                  nodes: current.order
                                      .map((id) => current.nodes[id]!)
                                      .map((node) => ({
                                          id: node.id,
                                          title: node.title,
                                          kind: kindOfNode(node),
                                          visible: viewport !== null && !current.hidden.has(node.id) && intersects(node, viewport)
                                      })),
                                  selected: current.selection
                                      .map((id) => current.nodes[id])
                                      .filter((node): node is ProjectNode => node !== undefined)
                                      .map((node) => ({
                                          id: node.id,
                                          title: node.title,
                                          kind: kindOfNode(node)
                                      }))
                              }
                            : null
                }
            };
        },
        'view.focus': ({ viewId }) => {
            const state = document.getState();
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw new ActionRefusal('unknown-view', `No view with id “${viewId}” exists in this project.`);
            }
            if (!isOpenableView(view)) {
                throw new ActionRefusal('view-not-openable', `“${view.name}” is a separator and cannot be focused.`);
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
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw new ActionRefusal('unknown-view', `No view with id “${viewId}” exists in this project.`);
            }
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
        'view.create': ({ kind, name, url, command }) => {
            const state = document.getState();
            const base = kind === 'chat' ? 'AI Chat' : kind.charAt(0).toUpperCase() + kind.slice(1);
            const title = name ?? freeViewName(document, base);
            const viewId =
                kind === 'canvas'
                    ? state.addCanvasView(title)
                    : kind === 'drawing'
                      ? state.addDrawingView(title)
                      : kind === 'diagram'
                        ? state.addDiagramView(title)
                        : kind === 'browser'
                          ? state.addStandaloneView({
                                kind,
                                name: title,
                                url: url ?? 'https://www.google.com'
                            })
                          : kind === 'chat'
                            ? state.addStandaloneView({
                                  kind,
                                  name: title,
                                  node: {}
                              })
                            : state.addStandaloneView({
                                  kind,
                                  name: title,
                                  node: command ? { command } : {}
                              });
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
        'view.delete': ({ viewId }, { confirmed }) => {
            const state = document.getState();
            const view = state.exportViews().find((candidate) => candidate.id === viewId);
            if (!view) {
                throw new ActionRefusal('unknown-view', `No view with id “${viewId}” exists in this project.`);
            }
            if (!confirmed) {
                const nodes = isCanvasView(view) ? view.nodes.length : 0;
                const sessions = isCanvasView(view)
                    ? view.nodes.filter((node) => node.kind === 'chat' || node.kind === 'terminal').length
                    : view.kind === 'chat' || view.kind === 'terminal'
                      ? 1
                      : 0;
                return {
                    confirmation: {
                        title: `Delete “${view.name}”?`,
                        consequences: [
                            nodes === 0 ? 'The view will be removed.' : `The view and its ${nodes} ${nodes === 1 ? 'node' : 'nodes'} will be removed.`,
                            ...(sessions === 0
                                ? []
                                : [`${sessions} ${sessions === 1 ? 'chat or terminal session' : 'chat or terminal sessions'} may be ended.`])
                        ]
                    }
                };
            }
            state.deleteView(viewId);
            return { output: { viewId, view: view.name ?? viewId, kind: kindOf(view) } };
        },
        'node.focus': ({ viewId, nodeId }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const node = canvas.nodes[nodeId];
            if (!node) {
                throw new ActionRefusal('unknown-node', `No node with id “${nodeId}” exists on “${view.name}”.`);
            }
            canvas.goToNode(nodeId);
            return {
                output: {
                    viewId,
                    view: view.name,
                    nodeId,
                    node: node.title,
                    kind: kindOfNode(node)
                }
            };
        },
        'node.rename': ({ viewId, nodeId, name }) => {
            const { canvas } = activeCanvas(document, viewId);
            const node = canvas.nodes[nodeId];
            if (!node || isUnknownNode(node)) {
                throw new ActionRefusal('unknown-node', `No renameable node with id “${nodeId}” exists on this canvas.`);
            }
            const previousName = node.title;
            const previousSource = node.titleSource ?? null;
            canvas.renameNode(nodeId, name);
            const changed = focusedCanvas().getState().nodes[nodeId]?.title === name && (previousName !== name || previousSource !== 'user');
            return {
                output: {
                    viewId,
                    nodeId,
                    kind: node.kind,
                    previousName,
                    name,
                    changed
                },
                ...(changed
                    ? {
                          undo: () => {
                              const current = activeCanvas(document, viewId).canvas.nodes[nodeId];
                              if (!current || current.title !== name || current.titleSource !== 'user') {
                                  throw new ActionRefusal('stale-undo', `“${name}” is no longer the current name of this node.`);
                              }
                              focusedCanvas().getState().renameNode(nodeId, previousName, previousSource);
                          }
                      }
                    : {})
            };
        },
        'node.create': ({ viewId, kind, title, content, url, command }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const depth = canvas.past.length;
            const nodeId = addNodeInFreeSpace(canvas, kind, {
                ...(title ? { title } : kind === 'note' && content ? { title: content.split('\n')[0]!.slice(0, 48) } : {}),
                ...(url && kind === 'browser' ? { url } : {}),
                ...(command && kind === 'terminal' ? { command } : {})
            });
            if (!nodeId) {
                throw new ActionRefusal('node-create-failed', `Ruimte could not create the ${kind} node.`);
            }
            if (kind === 'note' && content !== null) {
                focusedCanvas().getState().updateNode(nodeId, { body: content });
            }
            const node = focusedCanvas().getState().nodes[nodeId]!;
            return {
                output: {
                    viewId,
                    view: view.name,
                    nodeId,
                    node: node.title,
                    kind
                },
                undo: historyUndo(viewId, depth + 1, nodeId)
            };
        },
        'node.duplicate': ({ viewId, nodeId }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const source = canvas.nodes[nodeId];
            if (!source || isUnknownNode(source)) {
                throw new ActionRefusal('unknown-node', `No duplicable node with id “${nodeId}” exists on this canvas.`);
            }
            const depth = canvas.past.length;
            canvas.duplicateNode(nodeId);
            const copyId = focusedCanvas().getState().selection[0];
            const copy = copyId ? focusedCanvas().getState().nodes[copyId] : undefined;
            if (!copy) {
                throw new ActionRefusal('node-duplicate-failed', `Ruimte could not duplicate “${source.title}”.`);
            }
            return {
                output: {
                    viewId,
                    view: view.name,
                    sourceNodeId: nodeId,
                    nodeId: copy.id,
                    node: copy.title,
                    kind: kindOfNode(copy)
                },
                undo: historyUndo(viewId, depth + 1, copy.id)
            };
        },
        'canvas.select': ({ viewId, nodeIds }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const nodes = nodeIds.map((nodeId) => canvas.nodes[nodeId]);
            const missing = nodeIds.find((_nodeId, index) => nodes[index] === undefined);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node with id “${missing}” exists on “${view.name}”.`);
            }
            canvas.select(nodeIds);
            return { output: { viewId, view: view.name, nodeIds, nodes: nodes.map((node) => node!.title) } };
        },
        'node.delete': ({ viewId, nodeIds }, { confirmed }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const nodes = nodeIds.map((nodeId) => canvas.nodes[nodeId]);
            const missing = nodeIds.find((_nodeId, index) => nodes[index] === undefined);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node with id “${missing}” exists on “${view.name}”.`);
            }
            const titles = nodes.map((node) => node!.title);
            if (!confirmed) {
                const sessions = nodes.filter((node) => node?.kind === 'chat' || node?.kind === 'terminal').length;
                return {
                    confirmation: {
                        title: nodeIds.length === 1 ? `Delete “${titles[0]}”?` : `Delete ${nodeIds.length} nodes?`,
                        consequences: [
                            nodeIds.length === 1 ? 'The node and its connections will be removed.' : 'The nodes and their connections will be removed.',
                            ...(sessions === 0
                                ? []
                                : [`${sessions} ${sessions === 1 ? 'chat or terminal session' : 'chat or terminal sessions'} may be ended.`])
                        ]
                    }
                };
            }
            const depth = canvas.past.length;
            canvas.select(nodeIds);
            canvas.deleteSelected();
            return {
                output: { viewId, view: view.name, nodeIds, nodes: titles },
                undo: historyUndo(viewId, depth + 1)
            };
        },
        'group.create': ({ viewId, nodeIds }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const missing = nodeIds.find((id) => !canvas.nodes[id]);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node with id “${missing}” exists on this canvas.`);
            }
            const depth = canvas.past.length;
            canvas.select(nodeIds);
            const groupId = canvas.groupSelection();
            if (!groupId) {
                throw new ActionRefusal('group-create-failed', 'Select one or more non-group nodes before grouping them.');
            }
            return {
                output: { viewId, view: view.name, groupId, members: nodeIds },
                undo: historyUndo(viewId, depth + 1, groupId)
            };
        },
        'canvas.fit': ({ viewId }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            canvas.fitAll();
            return { output: { viewId, view: view.name } };
        },
        'history.undo': ({ viewId }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const before = canvas.past.length;
            canvas.undo();
            return {
                output: {
                    viewId,
                    view: view.name,
                    changed: focusedCanvas().getState().past.length !== before
                }
            };
        },
        'history.redo': ({ viewId }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const before = canvas.future.length;
            canvas.redo();
            return {
                output: {
                    viewId,
                    view: view.name,
                    changed: focusedCanvas().getState().future.length !== before
                }
            };
        },
        'chat.send': async ({ chatId, prompt }) => {
            const chat = chatTitle(document, chatId);
            if (!chat) {
                throw new ActionRefusal('unknown-chat', `No AI Chat with id “${chatId}” exists in this project.`);
            }
            const queued = await chatClient.send(chatId, prompt);
            return { output: { chatId, chat, queued } };
        }
    });

export const clientActions = createClientActionRegistry(useDocument);

export const PERSON_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'person', id: 'local-person' },
    context: undefined
};
export const VOICE_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'voice', id: 'voice-session' },
    context: undefined
};

export const focusViewAction = (viewId: string): void => {
    void clientActions.execute('view.focus', { viewId }, PERSON_ACTION_CALL);
};

export const renameViewAction = (viewId: string, name: string): void => {
    void clientActions.execute('view.rename', { viewId, name }, PERSON_ACTION_CALL);
};
