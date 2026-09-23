import { inspectionActions } from '@/actions/inspection-actions';
import { resolveTarget } from '@/actions/resolve-target';
import { ActionRefusal, ActionRegistry, type ActionCall, type ActionInput, type ActionName, type ActionOutput } from '@ruimte/actions';
import {
    canShareView,
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isOpenableView,
    isSessionView,
    isUnknownNode,
    isUnknownView,
    MAIN_VIEW_NAME,
    type AgentKind,
    type NodeTitleSource,
    type ProjectNode,
    type ProjectView,
    type ProviderInfo
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { addAgentView, agentNodeOptions, type AgentTarget } from '@/agents/nodes';
import { LOCK_KEYS } from '@/canvas/locks';
import { toWorld, type Point } from '@/canvas/math';
import { nearestFreeNodeRect } from '@/canvas/place-node';
import { recentChatMessages } from '@/chat/recent-messages';
import {
    liveViewDeletion,
    nodeDeletionFacts,
    saveNodeFiles,
    saveViewFiles,
    viewDeletionFacts,
    type ViewDeletionFacts,
    type ViewDeletionMachine
} from '@/project/view-deletion';
import { FILES_VIEW_ID } from '@/shell/files-view';
import { basenameOf, storedPathOf } from '@/shell/panels/files-tree';
import { canSplit, cellAt, cellCount, focusedViewId, freeViewFor, isSameCell, locateView, type SplitDirection } from '@/shell/split';
import { sightOf, visibleNodes } from '@/state/attention';
import { focusedCanvas, NODE_SIZE, type AddNodeOptions, type CanvasState, type Locks, type NodeKind } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { focusedDiagram } from '@/state/diagram';
import { activeViewOf, useDocument, viewOfNode, type DocumentState } from '@/state/document';
import { focusedDrawing } from '@/state/drawing';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { providersOf } from '@/state/providers';
import { chatClient, diagramClient, drawingClient, sessionClient } from '@/transport/connections';

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
    chat: 'AI Chat',
    file: 'File',
    separator: 'Separator',
    subheader: 'Section'
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

const addNodeInFreeSpace = (canvas: CanvasState, kind: NodeKind, options: AddNodeOptions): string | null => {
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

const hasNode =
    (id: string) =>
    (canvas: CanvasState): boolean =>
        canvas.nodes[id] !== undefined;

const historyUndo = (viewId: string, expectedDepth: number, stillThere?: (canvas: CanvasState) => boolean) => () => {
    const current = activeCanvas(useDocument, viewId).canvas;
    if (current.past.length !== expectedDepth || (stillThere && !stillThere(current))) {
        throw new ActionRefusal('stale-undo', 'The canvas changed after this action, so it cannot be safely undone here.');
    }
    current.undo();
};

/* Read from the exported views, so a node on any canvas on screen counts with what its editor holds. */
const sessionTitle = (document: StoreApi<DocumentState>, id: string, kind: 'chat' | 'terminal'): string | null => {
    for (const view of document.getState().exportViews()) {
        if (view.kind === kind && view.id === id) {
            return view.name;
        }
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === id && candidate.kind === kind);
            if (node) {
                return node.title;
            }
        }
    }
    return null;
};

const unknownView = (viewId: string): ActionRefusal => new ActionRefusal('unknown-view', `No view with id “${viewId}” exists in this project.`);

/* The canvas a view becomes a node on: the one that was up last, else the first there is. */
const lastCanvasOf = (state: DocumentState): (ProjectView & { kind: 'canvas' }) | null =>
    state.views.filter(isCanvasView).find((view) => view.id === state.lastCanvasViewId) ?? state.views.find(isCanvasView) ?? null;

/* What stands in a cell: a view of the project, or this client's files, which the document does not have. */
const cellName = (state: DocumentState, viewId: string): string =>
    viewId === FILES_VIEW_ID ? 'Files' : (state.views.find((view) => view.id === viewId)?.name ?? viewId);

const linesOf = (canvas: CanvasState, nodeId: string): number => canvas.edges.filter((edge) => edge.from === nodeId || edge.to === nodeId).length;

const linesRemoved = (lines: number): string => `${lines} ${lines === 1 ? 'line' : 'lines'} drawn to it will be removed.`;

/* The CLI a new chat or terminal runs, as this machine reports it. */
const agentFor = (
    providers: readonly ProviderInfo[],
    kind: string,
    provider: AgentKind | null,
    command: string | null
): { target: AgentTarget; info: ProviderInfo } | null => {
    if (provider === null) {
        return null;
    }
    if (kind !== 'chat' && kind !== 'terminal') {
        throw new ActionRefusal('invalid-provider', 'Only an AI Chat or a terminal runs an agent CLI.');
    }
    if (command !== null) {
        throw new ActionRefusal('invalid-provider', 'A terminal runs either an agent CLI or a command, not both.');
    }
    const info = providers.find((entry) => entry.kind === provider);
    if (!info?.installed) {
        throw new ActionRefusal('unknown-provider', `The ${provider} CLI is not installed on this machine.`);
    }
    if (!info.capabilities[kind]) {
        throw new ActionRefusal('unsupported-provider', `${info.name} cannot run in ${kind === 'chat' ? 'an AI Chat' : 'a terminal'}.`);
    }
    return { target: kind, info };
};

/* A path as a node or a view stores it: relative inside the project folder, absolute outside it. */
const storedFilePath = (path: string): string => storedPathOf(useProject.getState().current?.folder ?? null, path);

/* What a delete reaches besides what the document holds, in the words a confirmation reads. */
const deletionConsequences = ({ unsaved, working, ending }: ViewDeletionFacts, from: string): string[] => [
    ...(unsaved.length === 0 ? [] : [`Unsaved changes to ${quoted(unsaved.map(basenameOf))} will be saved first.`]),
    ...(working.length === 0 ? [] : [`${quoted(working)} ${working.length === 1 ? 'is' : 'are'} still working and will be stopped.`]),
    ...(ending.length === 0
        ? []
        : [
              `${listed(ending.map((title) => (title === null ? 'an agent' : `“${title}”`)))} ${ending.length === 1 ? 'was' : 'were'} started from ${from} and will end too.`
          ])
];

const sessionsEnded = (sessions: number): string[] =>
    sessions === 0 ? [] : [`${sessions} ${sessions === 1 ? 'chat or terminal session' : 'chat or terminal sessions'} may be ended.`];

/* The nodes a delete takes: the ones named, and what a collapsed group among them hides. */
const goingWith = (canvas: CanvasState, nodeIds: readonly string[]): ProjectNode[] => {
    const going = new Set(
        nodeIds.flatMap((id) => {
            const node = canvas.nodes[id];
            return node?.kind === 'group' && node.collapsed ? [id, ...(node.memberIds ?? [])] : [id];
        })
    );
    return [...going].flatMap((id) => canvas.nodes[id] ?? []);
};

/* A view of a kind that runs no agent, under the name it was given. */
const addViewOf = (
    state: DocumentState,
    kind: CreatableViewKind,
    title: string,
    { url, command, path }: { url: string | null; command: string | null; path: string | null }
): string => {
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
        case 'browser':
            return state.addStandaloneView({ kind, name: title, url: url ?? 'https://www.google.com' });
        case 'chat':
            return state.addStandaloneView({ kind, name: title, node: {} });
        case 'terminal':
            return state.addStandaloneView({ kind, name: title, node: command ? { command } : {} });
    }
};

export interface ClientActionMachine {
    clearChat(chatId: string): Promise<void>;
    clearTerminal(terminalId: string): void;
    /* The agent CLIs of the machine the project runs on. */
    providers(): readonly ProviderInfo[];
    /* A drawing or diagram keeps what it holds in a file of its own, which the daemon copies. */
    copyViewContent(kind: 'drawing' | 'diagram', from: string, to: string): void;
    viewDeletion: ViewDeletionMachine;
}

const LIVE_MACHINE: ClientActionMachine = {
    clearChat: (chatId) => chatClient.clear(chatId, true),
    clearTerminal: (terminalId) => sessionClient.clear(terminalId),
    providers: () => providersOf(currentEndpointId()).providers,
    copyViewContent: (kind, from, to) => void (kind === 'drawing' ? drawingClient.copy(from, to) : diagramClient.copy(from, to)),
    viewDeletion: liveViewDeletion
};

export const createClientActionRegistry = (document: StoreApi<DocumentState>, machine: Partial<ClientActionMachine> = {}): ActionRegistry<void> => {
    const { clearChat, clearTerminal, providers, copyViewContent, viewDeletion } = { ...LIVE_MACHINE, ...machine };
    return new ActionRegistry<void>({
        ...inspectionActions(document),
        'target.resolve': (input) => ({ output: resolveTarget(document, input) }),
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
        'view.create': ({ kind, name, url, command, path, provider }) => {
            const agent = agentFor(providers(), kind, provider, command);
            const state = document.getState();
            const title =
                kind === 'separator'
                    ? VIEW_BASE_NAMES.separator
                    : (name ?? agent?.info.name ?? (kind === 'file' && path !== null ? basenameOf(path) : freeName(state.views, VIEW_BASE_NAMES[kind])));
            const viewId = agent === null ? addViewOf(state, kind, title, { url, command, path }) : addAgentView(agent.target, agent.info, title);
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
        'node.create': ({ viewId, kind, title, content, url, command, path, provider, at }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const agent = agentFor(providers(), kind, provider, command);
            if (kind === 'file' && path === null) {
                throw new ActionRefusal('missing-path', 'Name the file a file node shows.');
            }
            const depth = canvas.past.length;
            const options: AddNodeOptions = {
                ...(agent === null ? {} : agentNodeOptions(agent.target, agent.info)),
                ...(title
                    ? { title }
                    : kind === 'note' && content
                      ? { title: content.split('\n')[0]!.slice(0, 48) }
                      : kind === 'file' && path
                        ? { title: basenameOf(path) }
                        : {}),
                ...(url && kind === 'browser' ? { url } : {}),
                ...(command && kind === 'terminal' ? { command } : {}),
                ...(path && kind === 'file' ? { path: storedFilePath(path) } : {})
            };
            const nodeId = at === null ? addNodeInFreeSpace(canvas, kind, options) : canvas.addNode(kind, at, options);
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
                undo: historyUndo(viewId, depth + 1, hasNode(nodeId))
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
                undo: historyUndo(viewId, depth + 1, hasNode(copy.id))
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
        'node.delete': async ({ viewId, nodeIds }, { confirmed }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const nodes = nodeIds.map((nodeId) => canvas.nodes[nodeId]);
            const missing = nodeIds.find((_nodeId, index) => nodes[index] === undefined);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node with id “${missing}” exists on “${view.name}”.`);
            }
            const titles = nodes.map((node) => node!.title);
            const what = nodeIds.length === 1 ? `“${titles[0]}”` : `${nodeIds.length} nodes`;
            const going = goingWith(canvas, nodeIds);
            if (!confirmed) {
                const facts = await nodeDeletionFacts(going, document.getState().exportViews(), viewDeletion);
                return {
                    confirmation: {
                        title: `Delete ${what}?`,
                        consequences: [
                            nodeIds.length === 1 ? 'The node and its connections will be removed.' : 'The nodes and their connections will be removed.',
                            ...sessionsEnded(going.filter((node) => node.kind === 'chat' || node.kind === 'terminal').length),
                            ...deletionConsequences(facts, nodeIds.length === 1 ? 'this node' : 'these nodes')
                        ]
                    }
                };
            }
            const unsaved = await saveNodeFiles(going, viewDeletion);
            if (unsaved.length > 0) {
                throw new ActionRefusal(
                    'unsaved-files',
                    `${quoted(unsaved.map(basenameOf))} could not be saved, so ${what} ${nodeIds.length === 1 ? 'was' : 'were'} kept.`
                );
            }
            // Saving waits on the machine, and the canvas may have moved on in the meantime.
            const current = activeCanvas(document, viewId).canvas;
            if (nodeIds.some((nodeId) => current.nodes[nodeId] === undefined)) {
                throw new ActionRefusal('unknown-node', `${nodeIds.length === 1 ? what : 'A node to delete'} is no longer on “${view.name}”.`);
            }
            const depth = current.past.length;
            current.select(nodeIds);
            current.deleteSelected();
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
                output: { viewId, view: view.name, groupId, members: nodeIds.filter((id) => canvas.nodes[id]?.kind !== 'group') },
                undo: historyUndo(viewId, depth + 1, hasNode(groupId))
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
        'canvasText.create': ({ viewId, text, at }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const depth = canvas.past.length;
            const textId = canvas.addText(at ?? centerWorld(canvas));
            if (text !== null) {
                const written = focusedCanvas().getState();
                written.updateText(textId, text);
                written.setEditingText(null);
            }
            return {
                output: { viewId, view: view.name, textId },
                undo: historyUndo(viewId, depth + 1, (current) => current.texts[textId] !== undefined)
            };
        },
        'node.promoteToView': ({ viewId, nodeId }, { confirmed }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const node = canvas.nodes[nodeId];
            if (!node) {
                throw new ActionRefusal('unknown-node', `No node with id “${nodeId}” exists on “${view.name}”.`);
            }
            if (node.kind !== 'chat' && node.kind !== 'terminal' && node.kind !== 'browser' && node.kind !== 'device') {
                throw new ActionRefusal(
                    'node-not-promotable',
                    `“${node.title}” is a ${node.kind} node; only a chat, terminal, browser or device becomes a view.`
                );
            }
            const lines = linesOf(canvas, nodeId);
            if (lines > 0 && !confirmed) {
                return { confirmation: { title: `Open “${node.title}” as a view?`, consequences: [linesRemoved(lines)] } };
            }
            if (document.getState().openAsView(nodeId) === null) {
                throw new ActionRefusal('node-promote-failed', `Ruimte could not open “${node.title}” as a view.`);
            }
            return {
                output: { viewId, nodeId, view: node.title, kind: node.kind },
                undo: () => {
                    const current = document.getState();
                    const promoted = current.views.find((candidate) => candidate.id === nodeId);
                    if (!promoted || !isSessionView(promoted) || !current.views.some((candidate) => candidate.id === viewId && isCanvasView(candidate))) {
                        throw new ActionRefusal('stale-undo', `“${node.title}” is no longer a view of its own, or its canvas is gone.`);
                    }
                    current.putOnCanvas(nodeId, viewId);
                }
            };
        },
        'node.moveToView': ({ viewId, nodeId, targetViewId }, { confirmed }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const node = canvas.nodes[nodeId];
            if (!node) {
                throw new ActionRefusal('unknown-node', `No node with id “${nodeId}” exists on “${view.name}”.`);
            }
            if (node.kind === 'group') {
                throw new ActionRefusal('node-not-movable', `The group “${node.title}” stays on its canvas; move the nodes in it one by one.`);
            }
            const target = document.getState().views.find((candidate) => candidate.id === targetViewId);
            if (!target || !isCanvasView(target)) {
                throw new ActionRefusal('unknown-view', `No canvas view with id “${targetViewId}” exists in this project.`);
            }
            if (targetViewId === viewId) {
                throw new ActionRefusal('same-view', `“${node.title}” is already on “${view.name}”.`);
            }
            const lines = linesOf(canvas, nodeId);
            if (lines > 0 && !confirmed) {
                return { confirmation: { title: `Move “${node.title}” to “${target.name}”?`, consequences: [linesRemoved(lines)] } };
            }
            document.getState().moveNodeToView(nodeId, targetViewId);
            const landed = document
                .getState()
                .views.some((candidate) => candidate.id === targetViewId && isCanvasView(candidate) && candidate.nodes.some((each) => each.id === nodeId));
            if (!landed) {
                throw new ActionRefusal('node-move-failed', `Ruimte could not move “${node.title}” to “${target.name}”.`);
            }
            return { output: { viewId, nodeId, node: node.title, targetViewId, target: target.name } };
        },
        'view.duplicate': ({ viewId }) => {
            const state = document.getState();
            const source = state.views.find((candidate) => candidate.id === viewId);
            if (!source) {
                throw unknownView(viewId);
            }
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
        'view.placeOnCanvas': ({ viewId }) => {
            const state = document.getState();
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw unknownView(viewId);
            }
            if (!isSessionView(view)) {
                throw new ActionRefusal(
                    'view-not-placeable',
                    `“${view.name}” is a ${view.kind} view; only a chat, terminal, browser or device view becomes a node.`
                );
            }
            const target = lastCanvasOf(state);
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
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw unknownView(viewId);
            }
            if (!isDrawingView(view) && !isDiagramView(view)) {
                throw new ActionRefusal('view-not-mirrorable', `“${view.name}” is a ${view.kind} view; only a drawing or diagram is shown on a canvas.`);
            }
            const target = lastCanvasOf(state);
            if (target === null) {
                throw new ActionRefusal('no-canvas', 'This project has no canvas to show the view on.');
            }
            state.showView(target.id);
            const { canvas } = activeCanvas(document, target.id);
            const depth = canvas.past.length;
            const nodeId = canvas.addNode(view.kind, centerWorld(canvas), { title: view.name, viewId });
            if (nodeId === null) {
                throw new ActionRefusal('node-create-failed', `Ruimte could not show “${view.name}” on “${target.name}”.`);
            }
            focusedCanvas().getState().goToNode(nodeId);
            return {
                output: { viewId, view: view.name, canvasViewId: target.id, canvas: target.name, nodeId },
                undo: historyUndo(target.id, depth + 1, hasNode(nodeId))
            };
        },
        'view.share': ({ viewId, shared }) => {
            const state = document.getState();
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw unknownView(viewId);
            }
            if (shared && !canShareView(view)) {
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
        'layout.save': ({ viewId, name }, { confirmed }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const previous = canvas.layouts.find((layout) => layout.name === name) ?? null;
            if (previous !== null && !confirmed) {
                return {
                    confirmation: {
                        title: `Replace layout “${name}”?`,
                        consequences: [`The layout saved as “${name}” will be replaced by where everything on “${view.name}” is now.`]
                    }
                };
            }
            canvas.saveLayout(name);
            const saved = focusedCanvas()
                .getState()
                .layouts.find((layout) => layout.name === name);
            return {
                output: { viewId, view: view.name, name, replaced: previous !== null },
                undo: () => {
                    const current = activeCanvas(document, viewId).canvas;
                    if (current.layouts.find((layout) => layout.name === name) !== saved) {
                        throw new ActionRefusal('stale-undo', `The layout “${name}” changed after this action.`);
                    }
                    if (previous === null) {
                        current.deleteLayout(name);
                    } else {
                        current.putLayout(previous);
                    }
                }
            };
        },
        'layout.apply': ({ viewId, name }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            if (!canvas.layouts.some((layout) => layout.name === name)) {
                throw new ActionRefusal('unknown-layout', `“${view.name}” has no layout saved as “${name}”.`);
            }
            const depth = canvas.past.length;
            canvas.applyLayout(name);
            return { output: { viewId, view: view.name, name }, undo: historyUndo(viewId, depth + 1) };
        },
        'layout.delete': ({ viewId, name }, { confirmed }) => {
            const { view, canvas } = activeCanvas(document, viewId);
            const layout = canvas.layouts.find((candidate) => candidate.name === name);
            if (!layout) {
                throw new ActionRefusal('unknown-layout', `“${view.name}” has no layout saved as “${name}”.`);
            }
            if (!confirmed) {
                return {
                    confirmation: { title: `Delete layout “${name}”?`, consequences: ['The saved arrangement will be removed. The nodes stay where they are.'] }
                };
            }
            canvas.deleteLayout(name);
            return {
                output: { viewId, view: view.name, name },
                undo: () => {
                    const current = activeCanvas(document, viewId).canvas;
                    if (current.layouts.some((candidate) => candidate.name === name)) {
                        throw new ActionRefusal('stale-undo', `A layout called “${name}” was saved again after this action.`);
                    }
                    current.putLayout(layout);
                }
            };
        },
        'canvas.setLocks': ({ viewId, locked, gestures }) => {
            const { view } = activeCanvas(document, viewId);
            for (const key of gestures ?? LOCK_KEYS) {
                if (focusedCanvas().getState().locks[key] !== locked) {
                    focusedCanvas().getState().toggleLock(key);
                }
            }
            const locks: Locks = focusedCanvas().getState().locks;
            return { output: { viewId, view: view.name, locks: { ...locks } } };
        },
        'split.create': ({ direction, viewId }) => {
            const state = document.getState();
            const layout = state.layout;
            if (layout === null) {
                throw new ActionRefusal('no-grid', 'No view is open to split.');
            }
            const target = viewId ?? freeViewFor(state);
            if (target === null) {
                throw new ActionRefusal('no-free-view', 'Every view is already on screen, so there is none to put beside them.');
            }
            const view = state.views.find((candidate) => candidate.id === target);
            if (!view || !isOpenableView(view)) {
                throw unknownView(target);
            }
            if (!canSplit(layout, layout.focus, direction, target)) {
                throw new ActionRefusal('no-room', `There is no room for another cell ${direction === 'right' ? 'to the right' : 'below'}.`);
            }
            state.splitFocused(direction, target);
            return { output: { viewId: target, view: view.name ?? target, direction } };
        },
        'split.close': ({ viewId }) => {
            const state = document.getState();
            const layout = state.layout;
            if (layout === null || cellCount(layout) < 2) {
                throw new ActionRefusal('last-cell', 'Only one cell is open, and the last one stays.');
            }
            const at = viewId === null ? layout.focus : locateView(layout, viewId);
            const closing = at === null ? null : cellAt(layout, at);
            if (at === null || closing === null) {
                throw new ActionRefusal('view-not-shown', `“${cellName(state, viewId ?? '')}” does not stand in a cell.`);
            }
            state.closeCellAt(at);
            return { output: { viewId: closing.viewId, view: cellName(state, closing.viewId) } };
        },
        'split.focus': ({ direction }) => {
            const state = document.getState();
            if (state.layout === null) {
                throw new ActionRefusal('no-grid', 'No view is open.');
            }
            const before = state.layout.focus;
            state.focusTowards(direction);
            const after = document.getState().layout ?? state.layout;
            const viewId = focusedViewId(after);
            if (viewId === null) {
                throw new ActionRefusal('no-grid', 'No view is open.');
            }
            return { output: { viewId, view: cellName(state, viewId), changed: !isSameCell(before, after.focus) } };
        },
        'terminal.clear': ({ terminalId }, { confirmed }) => {
            const terminal = sessionTitle(document, terminalId, 'terminal');
            if (terminal === null) {
                throw new ActionRefusal('unknown-terminal', `No terminal with id “${terminalId}” exists in this project.`);
            }
            if (!confirmed) {
                return {
                    confirmation: {
                        title: `Clear terminal “${terminal}”?`,
                        consequences: ['The screen and its scrollback will be cleared. This cannot be undone.', 'What runs in it keeps running.']
                    }
                };
            }
            clearTerminal(terminalId);
            return { output: { terminalId, terminal } };
        },
        'chat.send': async ({ chatId, prompt }) => {
            const chat = sessionTitle(document, chatId, 'chat');
            if (!chat) {
                throw new ActionRefusal('unknown-chat', `No AI Chat with id “${chatId}” exists in this project.`);
            }
            const submitted = await chatClient.send(chatId, prompt);
            return { output: { chatId, chat, ...submitted } };
        },
        'chat.clear': async ({ chatId }, { confirmed }) => {
            const chat = sessionTitle(document, chatId, 'chat');
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
            const chat = sessionTitle(document, chatId, 'chat');
            if (!chat) {
                throw new ActionRefusal('unknown-chat', `No AI Chat with id “${chatId}” exists in this project.`);
            }
            const state = useChats.getState().byKey[endpointKey(currentEndpointId(), chatId)];
            if (!state) {
                throw new ActionRefusal('chat-not-loaded', `Open “${chat}” before asking Voice to read it.`);
            }
            return { output: { chatId, chat, ...recentChatMessages(state.items, state.order, limit ?? 20) } };
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
const runAsPerson = async <Name extends ActionName>(name: Name, input: ActionInput<Name>): Promise<ActionOutput<Name> | null> => {
    const result = await clientActions.execute(name, input, PERSON_ACTION_CALL);
    return result.status === 'completed' ? result.output : null;
};

/* The person already answered the app's own dialogs before this runs, so the confirmation is theirs to give. */
const runConfirmedAsPerson = async <Name extends ActionName>(name: Name, input: ActionInput<Name>): Promise<ActionOutput<Name> | null> => {
    const asked = await clientActions.execute(name, input, PERSON_ACTION_CALL);
    if (asked.status === 'needs_confirmation') {
        const confirmed = await clientActions.confirm(asked.confirmationToken, true, PERSON_ACTION_CALL);
        return confirmed.status === 'completed' ? (confirmed.output as ActionOutput<Name>) : null;
    }
    return asked.status === 'completed' ? asked.output : null;
};

const activeViewId = (): string | null => useDocument.getState().activeViewId;

export const focusViewAction = (viewId: string): void => {
    void runAsPerson('view.focus', { viewId });
};

export const renameViewAction = (viewId: string, name: string): void => {
    void runAsPerson('view.rename', { viewId, name });
};

export interface CreateViewOptions {
    name?: string;
    url?: string;
    path?: string;
    provider?: AgentKind;
}

/* Resolves the id of the new view, or null when there is none. */
export const createViewAction = async (kind: CreatableViewKind, options: CreateViewOptions = {}): Promise<string | null> => {
    const created = await runAsPerson('view.create', {
        kind,
        name: options.name ?? null,
        url: options.url ?? null,
        command: null,
        path: options.path ?? null,
        provider: options.provider ?? null
    });
    return created?.viewId ?? null;
};

export const deleteViewAction = (viewId: string): void => {
    void runConfirmedAsPerson('view.delete', { viewId });
};

export const duplicateViewAction = (viewId: string): void => {
    void runAsPerson('view.duplicate', { viewId });
};

export const placeViewOnCanvasAction = (viewId: string): void => {
    void runAsPerson('view.placeOnCanvas', { viewId });
};

/* Resolves the id of the node that mirrors the view. */
export const showViewOnCanvasAction = async (viewId: string): Promise<string | null> => (await runAsPerson('view.showOnCanvas', { viewId }))?.nodeId ?? null;

/* Resolves how to take it back, or null when nothing happened. */
export const shareViewAction = async (viewId: string, shared: boolean): Promise<{ view: string; undo: () => void } | null> => {
    const result = await clientActions.execute('view.share', { viewId, shared }, PERSON_ACTION_CALL);
    if (result.status !== 'completed') {
        return null;
    }
    const { undoToken } = result;
    return {
        view: result.output.view,
        undo: () => {
            if (undoToken) {
                void clientActions.undo(undoToken, PERSON_ACTION_CALL);
            }
        }
    };
};

export const focusNodeAction = (viewId: string | null, nodeId: string): void => {
    if (viewId !== null) {
        void runAsPerson('node.focus', { viewId, nodeId });
    }
};

export const duplicateNodeAction = (viewId: string | null, nodeId: string): void => {
    if (viewId !== null) {
        void runAsPerson('node.duplicate', { viewId, nodeId });
    }
};

export const renameNodeAction = (viewId: string | null, nodeId: string, name: string): void => {
    if (viewId !== null) {
        void runAsPerson('node.rename', { viewId, nodeId, name });
    }
};

/* The lines a node leaves behind were asked about by the promote dialog, when it had any. */
export const promoteNodeAction = (nodeId: string): void => {
    const viewId = viewOfNode(useDocument.getState().views, nodeId)?.id ?? activeViewId();
    if (viewId !== null) {
        void runConfirmedAsPerson('node.promoteToView', { viewId, nodeId });
    }
};

export const moveNodeToViewAction = (nodeId: string, targetViewId: string): void => {
    const viewId = activeViewId();
    if (viewId !== null) {
        void runConfirmedAsPerson('node.moveToView', { viewId, nodeId, targetViewId });
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
        void runAsPerson('canvas.fit', { viewId });
    }
};

export interface CreateNodeOptions {
    url?: string;
    provider?: AgentKind;
    path?: string;
    /* The node's middle in world units, which a click or a drop knows and a menu does not. */
    at?: Point;
}

/* On the canvas on screen, at `at` or in free space near the middle of what it shows. Resolves the new node's id. */
export const createNodeAction = async (kind: CreatableNodeKind, options: CreateNodeOptions = {}): Promise<string | null> => {
    const viewId = activeViewId();
    if (viewId === null) {
        return null;
    }
    const created = await runAsPerson('node.create', {
        viewId,
        kind,
        title: null,
        content: null,
        url: options.url ?? null,
        command: null,
        path: options.path ?? null,
        provider: options.provider ?? null,
        at: options.at ?? null
    });
    return created?.nodeId ?? null;
};

/* Empty and open for typing, the way a double-click on the canvas starts one. */
export const createTextAction = (at: Point | null = null): void => {
    const viewId = activeViewId();
    if (viewId !== null) {
        void runAsPerson('canvasText.create', { viewId, text: null, at });
    }
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
    void runAsPerson('group.create', { viewId, nodeIds });
};

export const historyAction = (step: 'undo' | 'redo'): void => {
    const viewId = activeViewId();
    if (viewId === null) {
        return;
    }
    void runAsPerson(step === 'undo' ? 'history.undo' : 'history.redo', { viewId });
};

/* The layout dialog and the dock's delete corner are the person's answer; neither asks about replacing or losing one. */
export const saveLayoutAction = (name: string): void => {
    const viewId = activeViewId();
    if (viewId !== null) {
        void runConfirmedAsPerson('layout.save', { viewId, name });
    }
};

export const applyLayoutAction = (name: string): void => {
    const viewId = activeViewId();
    if (viewId !== null) {
        void runAsPerson('layout.apply', { viewId, name });
    }
};

export const deleteLayoutAction = (name: string): void => {
    const viewId = activeViewId();
    if (viewId !== null) {
        void runConfirmedAsPerson('layout.delete', { viewId, name });
    }
};

/* Null sets every gesture at once. */
export const setLocksAction = (locked: boolean, gestures: (keyof Locks)[] | null = null): void => {
    const viewId = activeViewId();
    if (viewId !== null) {
        void runAsPerson('canvas.setLocks', { viewId, locked, gestures });
    }
};

export const splitAction = (direction: 'right' | 'down'): void => {
    void runAsPerson('split.create', { direction, viewId: null });
};

/* Null closes the focused cell. */
export const closeCellAction = (viewId: string | null = null): void => {
    void runAsPerson('split.close', { viewId });
};

export const focusCellAction = (direction: SplitDirection): void => {
    void runAsPerson('split.focus', { direction });
};

/* A person's key or menu row is the answer, as a terminal's own Cmd+K always was. */
export const clearTerminalAction = (terminalId: string): void => {
    void runConfirmedAsPerson('terminal.clear', { terminalId });
};
