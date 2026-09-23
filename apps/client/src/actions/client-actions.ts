import { inspectionActions } from '@/actions/inspection-actions';
import { ActionRefusal, ActionRegistry, type ActionCall, type ActionInput, type ActionName, type ActionOutput } from '@ruimte/actions';
import {
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isOpenableView,
    isUnknownNode,
    isUnknownView,
    MAIN_VIEW_NAME,
    type NodeTitleSource,
    type ProjectNode,
    type ProjectView
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { toWorld } from '@/canvas/math';
import { nearestFreeNodeRect } from '@/canvas/place-node';
import { recentChatMessages } from '@/chat/recent-messages';
import { liveViewDeletion, saveViewFiles, viewDeletionFacts, type ViewDeletionMachine } from '@/project/view-deletion';
import { basenameOf } from '@/shell/panels/files-tree';
import { sightOf, visibleNodes } from '@/state/attention';
import { focusedCanvas, NODE_SIZE, type CanvasState, type NodeKind } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { focusedDiagram } from '@/state/diagram';
import { activeViewOf, useDocument, type DocumentState } from '@/state/document';
import { focusedDrawing } from '@/state/drawing';
import { currentEndpointId, endpointKey } from '@/state/keys';
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

type CreatableViewKind = ActionInput<'view.create'>['kind'];
type CreatableNodeKind = ActionInput<'node.create'>['kind'];

const VIEW_BASE_NAMES: Record<CreatableViewKind, string> = {
    canvas: MAIN_VIEW_NAME,
    drawing: 'Drawing',
    diagram: 'Diagram',
    terminal: 'Terminal',
    browser: 'Browser',
    chat: 'AI Chat'
};

/* A new view is named after what it is, "Canvas", then "Canvas 2", until someone renames it. */
export const freeName = (views: readonly ProjectView[], base: string): string => {
    const taken = new Set(views.flatMap((view) => (view.name === undefined ? [] : [view.name])));
    if (!taken.has(base)) {
        return base;
    }
    let counter = 2;
    while (taken.has(`${base} ${counter}`)) {
        counter += 1;
    }
    return `${base} ${counter}`;
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

/* The editor of the view on screen: a canvas, a drawing and a diagram each keep their own history and camera. */
const activeEditor = (document: StoreApi<DocumentState>, viewId: string, doing: string) => {
    const view = activeViewOf(document.getState());
    if (!view || view.id !== viewId || !(isCanvasView(view) || isDrawingView(view) || isDiagramView(view))) {
        throw new ActionRefusal('inactive-view', `Open the target canvas, drawing or diagram before ${doing}.`);
    }
    const editor = isCanvasView(view) ? focusedCanvas() : isDrawingView(view) ? focusedDrawing() : focusedDiagram();
    return { view, editor: () => editor.getState() };
};

const listed = (items: readonly string[]): string => (items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

const quoted = (names: readonly string[]): string => listed(names.map((name) => `“${name}”`));

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

export interface ClientActionMachine {
    clearChat(chatId: string): Promise<void>;
    viewDeletion: ViewDeletionMachine;
}

const LIVE_MACHINE: ClientActionMachine = {
    clearChat: (chatId) => chatClient.clear(chatId, true),
    viewDeletion: liveViewDeletion
};

export const createClientActionRegistry = (document: StoreApi<DocumentState>, machine: Partial<ClientActionMachine> = {}): ActionRegistry<void> => {
    const { clearChat, viewDeletion } = { ...LIVE_MACHINE, ...machine };
    return new ActionRegistry<void>({
        ...inspectionActions(document),
        'workspace.inspect': () => {
            const state = document.getState();
            const active = activeViewOf(state);
            const current = active && isCanvasView(active) ? focusedCanvas().getState() : null;
            const inSight = current === null ? new Set<string>() : new Set(visibleNodes(sightOf(current), { readable: false }));
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
                                          visible: inSight.has(node.id)
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
                throw new ActionRefusal('view-not-openable', `“${view.name}” is a ${view.kind} and cannot be focused.`);
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
            const title = name ?? freeName(state.views, VIEW_BASE_NAMES[kind]);
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
        'view.delete': async ({ viewId }, { confirmed }) => {
            const exported = () =>
                document
                    .getState()
                    .exportViews()
                    .find((candidate) => candidate.id === viewId);
            const view = exported();
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
                const { unsaved, working, ending } = await viewDeletionFacts(view, document.getState().exportViews(), viewDeletion);
                return {
                    confirmation: {
                        title: `Delete “${view.name}”?`,
                        consequences: [
                            nodes === 0 ? 'The view will be removed.' : `The view and its ${nodes} ${nodes === 1 ? 'node' : 'nodes'} will be removed.`,
                            ...(sessions === 0
                                ? []
                                : [`${sessions} ${sessions === 1 ? 'chat or terminal session' : 'chat or terminal sessions'} may be ended.`]),
                            ...(unsaved.length === 0 ? [] : [`Unsaved changes to ${quoted(unsaved.map(basenameOf))} will be saved first.`]),
                            ...(working.length === 0 ? [] : [`${quoted(working)} ${working.length === 1 ? 'is' : 'are'} still working and will be stopped.`]),
                            ...(ending.length === 0
                                ? []
                                : [
                                      `${listed(ending.map((title) => (title === null ? 'an agent' : `“${title}”`)))} ${ending.length === 1 ? 'was' : 'were'} started from this view and will end too.`
                                  ])
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
            document.getState().deleteView(viewId);
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
            const { view, editor } = activeEditor(document, viewId, 'fitting it in view');
            editor().fitAll();
            return { output: { viewId, view: view.name } };
        },
        'history.undo': ({ viewId }) => {
            const { view, editor } = activeEditor(document, viewId, 'undoing or redoing a change in it');
            const before = editor().past.length;
            editor().undo();
            return { output: { viewId, view: view.name, changed: editor().past.length !== before } };
        },
        'history.redo': ({ viewId }) => {
            const { view, editor } = activeEditor(document, viewId, 'undoing or redoing a change in it');
            const before = editor().future.length;
            editor().redo();
            return { output: { viewId, view: view.name, changed: editor().future.length !== before } };
        },
        'chat.send': async ({ chatId, prompt }) => {
            const chat = chatTitle(document, chatId);
            if (!chat) {
                throw new ActionRefusal('unknown-chat', `No AI Chat with id “${chatId}” exists in this project.`);
            }
            const submitted = await chatClient.send(chatId, prompt);
            return { output: { chatId, chat, ...submitted } };
        },
        'chat.clear': async ({ chatId }, { confirmed }) => {
            const chat = chatTitle(document, chatId);
            if (!chat) {
                throw new ActionRefusal('unknown-chat', 'This AI Chat no longer exists in the current project.');
            }
            if (!confirmed) {
                return {
                    confirmation: {
                        title: `Clear AI Chat “${chat}”?`,
                        consequences: [
                            'The conversation history, attachments and plans will be deleted. This cannot be undone.',
                            'Any current turn and queued messages in this chat will be stopped or discarded. The chat itself stays in place.'
                        ]
                    }
                };
            }
            await clearChat(chatId);
            return { output: { chatId, chat } };
        },
        'chat.read': ({ chatId, limit }) => {
            const chat = chatTitle(document, chatId);
            if (!chat) {
                throw new ActionRefusal('unknown-chat', `No AI Chat with id “${chatId}” exists in this project.`);
            }
            const state = useChats.getState().byKey[endpointKey(currentEndpointId(), chatId)];
            if (!state) {
                throw new ActionRefusal('chat-not-loaded', `Open “${chat}” before asking Voice to read it.`);
            }
            return { output: { chatId, chat, ...recentChatMessages(state.items, state.order, limit) } };
        }
    });
};

export const clientActions = createClientActionRegistry(useDocument);

export const PERSON_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'person', id: 'local-person' },
    context: undefined
};
export const VOICE_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'voice', id: 'voice-session' },
    context: undefined
};

/* A person sees what happened on screen, so a refusal stays as quiet as the store call it replaced. */
const runAsPerson = <Name extends ActionName>(name: Name, input: ActionInput<Name>): void => {
    void clientActions.execute(name, input, PERSON_ACTION_CALL);
};

/* The person already answered the app's own dialogs before this runs, so the confirmation is theirs to give. */
const runConfirmedAsPerson = async <Name extends ActionName>(name: Name, input: ActionInput<Name>): Promise<void> => {
    const asked = await clientActions.execute(name, input, PERSON_ACTION_CALL);
    if (asked.status === 'needs_confirmation') {
        await clientActions.confirm(asked.confirmationToken, true, PERSON_ACTION_CALL);
    }
};

const activeViewId = (): string | null => useDocument.getState().activeViewId;

export const focusViewAction = (viewId: string): void => {
    runAsPerson('view.focus', { viewId });
};

export const renameViewAction = (viewId: string, name: string): void => {
    runAsPerson('view.rename', { viewId, name });
};

export const createViewAction = (kind: CreatableViewKind): void => {
    runAsPerson('view.create', { kind, name: null, url: null, command: null });
};

export const deleteViewAction = (viewId: string): void => {
    void runConfirmedAsPerson('view.delete', { viewId });
};

export const focusNodeAction = (viewId: string | null, nodeId: string): void => {
    if (viewId !== null) {
        runAsPerson('node.focus', { viewId, nodeId });
    }
};

export const duplicateNodeAction = (viewId: string | null, nodeId: string): void => {
    if (viewId !== null) {
        runAsPerson('node.duplicate', { viewId, nodeId });
    }
};

export const renameNodeAction = (viewId: string | null, nodeId: string, name: string): void => {
    if (viewId !== null) {
        runAsPerson('node.rename', { viewId, nodeId, name });
    }
};

/*
 * The action names nodes on the canvas in focus and nothing else. A pick that also holds text or a
 * line, or that stands on a canvas outside the focus, goes to its own store in one step, so a single
 * undo still brings all of it back.
 */
export const deleteNodesAction = (store: StoreApi<CanvasState>, ids: readonly string[]): void => {
    const canvas = store.getState();
    if (canvas.viewId !== null && store === focusedCanvas() && ids.length > 0 && ids.every((id) => canvas.nodes[id] !== undefined)) {
        void runConfirmedAsPerson('node.delete', { viewId: canvas.viewId, nodeIds: [...ids] });
        return;
    }
    canvas.select([...ids]);
    canvas.deleteSelected();
};

export const fitAction = (): void => {
    const viewId = activeViewId();
    if (viewId !== null) {
        runAsPerson('canvas.fit', { viewId });
    }
};

/* On the canvas on screen, in free space near the middle of what it shows. */
export const createNodeAction = (kind: CreatableNodeKind, url: string | null = null): void => {
    const viewId = activeViewId();
    if (viewId === null) {
        return;
    }
    runAsPerson('node.create', { viewId, kind, title: null, content: null, url, command: null });
};

/* A group never goes inside a new group, so only the other selected nodes become its members. */
export const groupSelectionAction = (): void => {
    const viewId = activeViewId();
    const { selection, nodes } = focusedCanvas().getState();
    const nodeIds = selection.filter((id) => {
        const node = nodes[id];
        return node !== undefined && node.kind !== 'group';
    });
    if (viewId === null || nodeIds.length === 0) {
        return;
    }
    runAsPerson('group.create', { viewId, nodeIds });
};

export const historyAction = (step: 'undo' | 'redo'): void => {
    const viewId = activeViewId();
    if (viewId === null) {
        return;
    }
    runAsPerson(step === 'undo' ? 'history.undo' : 'history.redo', { viewId });
};
