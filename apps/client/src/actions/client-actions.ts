import { contentActions, type ContentMachine } from '@/actions/content-actions';
import { asksFirst, asRefusal, developerActions, GIT_OPERATION, type DeveloperMachine } from '@/actions/developer-actions';
import { filesActions, projectPathOf, type FilesMachine } from '@/actions/files-actions';
import { inspectionActions } from '@/actions/inspection-actions';
import { machineActions, type MachineReach } from '@/actions/machine-actions';
import { pageActions, type PageMachine } from '@/actions/page-actions';
import { projectActions, type ProjectMachine } from '@/actions/project-actions';
import { sessionActions, sessionTitle, type SessionMachine } from '@/actions/session-actions';
import { resolveTarget } from '@/actions/resolve-target';
import { checkClientRevision } from '@/actions/revision';
import {
    ActionRefusal,
    ActionRegistry,
    MAX_TITLE_LENGTH,
    type ActionCall,
    type ActionHandlers,
    type ActionInput,
    type ActionName,
    type ActionOutput
} from '@ruimte/actions';
import {
    canShareView,
    flagOf,
    isCanvasView,
    isDiagramView,
    isDrawingView,
    isOpenableView,
    isSessionView,
    isUnknownNode,
    isUnknownView,
    MAIN_VIEW_NAME,
    type AgentKind,
    type DeviceReference,
    type NodeAccent,
    type NodeTitleSource,
    type NoteColor,
    type ProjectIconChoice,
    type ProjectNode,
    type ProjectView,
    type ProviderInfo,
    PROJECT_ICON_NAMES,
    viewIconOf
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { addAgentView, agentNodeOptions, type AgentSession, type AgentTarget } from '@/agents/nodes';
import { LOCK_KEYS } from '@/canvas/locks';
import { toWorld, type Point } from '@/canvas/math';
import { nearestFreeNodeRect } from '@/canvas/place-node';
import type { ChatSendExtras } from '@/chat/chat-client';
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
import { lastFlagColor, rememberFlagColor } from '@/project/flag-color';
import { offerViewUndo } from '@/project/view-trash';
import type { PromptClients } from '@/prompts/logic/subjects';
import { FILES_VIEW_ID } from '@/shell/files-view';
import { basenameOf, storedPathOf } from '@/shell/panels/files-tree';
import { canSplit, cellAt, cellCount, focusedViewId, freeViewFor, isSameCell, locateView, type SplitDirection, type SplitZone } from '@/shell/split';
import { sightOf, visibleNodes } from '@/state/attention';
import { defaultCanvases, focusedCanvas, liveCanvas, NODE_SIZE, type AddNodeOptions, type CanvasState, type Locks, type NodeKind } from '@/state/canvas';
import { useChats } from '@/state/chats';
import { liveDiagram } from '@/state/diagram';
import { activeViewOf, useDocument, viewOfNode, type DocumentState } from '@/state/document';
import { liveDrawing } from '@/state/drawing';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { useProject } from '@/state/project';
import { providersOf } from '@/state/providers';
import { chatClient, diagramClient, drawingClient, sessionClient } from '@/transport/connections';

const kindOf = (view: ProjectView): ActionOutput<'view.focus'>['kind'] => (isUnknownView(view) ? 'unknown' : view.kind);
const kindOfNode = (node: ProjectNode): ActionOutput<'node.focus'>['kind'] => (isUnknownNode(node) ? 'unknown' : node.kind);

/* A view in any cell of the grid. Only a view on screen has an editor, and so anything to act on. */
const isOnScreen = (state: DocumentState, viewId: string): boolean => state.layout !== null && locateView(state.layout, viewId) !== null;

/* The focus says nothing here: a blur that lands after a press in another cell still means the canvas it left. */
const canvasOnScreen = (document: StoreApi<DocumentState>, viewId: string): { view: ProjectView & { kind: 'canvas' }; canvas: CanvasState } => {
    const state = document.getState();
    const view = state.views.find((candidate) => candidate.id === viewId);
    const canvas = isOnScreen(state, viewId) ? liveCanvas(viewId) : null;
    if (!view || !isCanvasView(view) || canvas === null) {
        throw new ActionRefusal('inactive-canvas', 'Open the target canvas before changing its nodes.');
    }
    return { view, canvas };
};

/* What a canvas holds after a change, since the state read before it is a snapshot. */
const canvasNow = (document: StoreApi<DocumentState>, viewId: string): CanvasState => canvasOnScreen(document, viewId).canvas;

/* A name needs no editor, so a rename also reaches a canvas on no cell, through the view the document keeps. */
const nodeToName = (document: StoreApi<DocumentState>, viewId: string, nodeId: string): ProjectNode | undefined => {
    const view = document
        .getState()
        .exportViews()
        .find((candidate) => candidate.id === viewId);
    if (!view || !isCanvasView(view)) {
        throw new ActionRefusal('unknown-view', `No canvas view with id “${viewId}” exists in this project.`);
    }
    return view.nodes.find((node) => node.id === nodeId);
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
    subheader: 'Section',
    device: 'Device'
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

/* What a view is called when nobody named it: what it shows, else what it is. */
const derivedViewName = (
    state: DocumentState,
    kind: CreatableViewKind,
    { url, path, device }: { url: string | null; path: string | null; device: DeviceReference | null | undefined }
): string => {
    if (kind === 'file' && path !== null) {
        return basenameOf(path);
    }
    if (kind === 'browser' && url !== null) {
        return url;
    }
    if (kind === 'device' && device != null) {
        return device.name;
    }
    return freeName(state.views, VIEW_BASE_NAMES[kind]);
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

/* The editor of a view on screen: a canvas, a drawing and a diagram each keep their own history and camera. */
const editorOnScreen = (document: StoreApi<DocumentState>, viewId: string, doing: string) => {
    const state = document.getState();
    const view = state.views.find((candidate) => candidate.id === viewId);
    const refusal = () => new ActionRefusal('inactive-view', `Open the target canvas, drawing or diagram before ${doing}.`);
    if (!view || !(isCanvasView(view) || isDrawingView(view) || isDiagramView(view))) {
        throw refusal();
    }
    const live = isCanvasView(view) ? liveCanvas : isDrawingView(view) ? liveDrawing : liveDiagram;
    if (!isOnScreen(state, viewId) || live(viewId) === null) {
        throw refusal();
    }
    return { view, editor: () => live(viewId)! };
};

const listed = (items: readonly string[]): string => (items.length === 1 ? items[0]! : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`);

const quoted = (names: readonly string[]): string => listed(names.map((name) => `“${name}”`));

const hasNode =
    (id: string) =>
    (canvas: CanvasState): boolean =>
        canvas.nodes[id] !== undefined;

const historyUndo =
    (viewId: string, expectedDepth: number, stillThere?: (canvas: CanvasState) => boolean, steps = 1) =>
    () => {
        const current = canvasNow(useDocument, viewId);
        if (current.past.length !== expectedDepth || (stillThere && !stillThere(current))) {
            throw new ActionRefusal('stale-undo', 'The canvas changed after this action, so it cannot be safely undone here.');
        }
        for (let i = 0; i < steps; i++) {
            current.undo();
        }
    };

const unknownView = (viewId: string): ActionRefusal => new ActionRefusal('unknown-view', `No view with id “${viewId}” exists in this project.`);

/* The canvas a view becomes a node on: the one that was up last, else the first there is. */
const lastCanvasOf = (state: DocumentState): (ProjectView & { kind: 'canvas' }) | null =>
    state.views.filter(isCanvasView).find((view) => view.id === state.lastCanvasViewId) ?? state.views.find(isCanvasView) ?? null;

/* What stands in a cell: a view of the project, or this client's files, which the document does not have. */
const cellName = (state: DocumentState, viewId: string): string =>
    viewId === FILES_VIEW_ID ? 'Files' : (state.views.find((view) => view.id === viewId)?.name ?? viewId);

/* The cells of the grid column by column, each named by the view standing in it. */
const cellsOf = (state: DocumentState): ActionOutput<'workspace.inspect'>['cells'] => {
    const layout = state.layout;
    if (layout === null) {
        return [];
    }
    return layout.columns.flatMap((column, columnIndex) =>
        column.cells.map((cell, cellIndex) => ({
            viewId: cell.viewId,
            view: cellName(state, cell.viewId),
            column: columnIndex,
            cell: cellIndex,
            focused: isSameCell(layout.focus, { column: columnIndex, cell: cellIndex })
        }))
    );
};

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
    { url, command, path, device, cwd }: { url: string | null; command: string | null; path: string | null; device: DeviceReference | null; cwd: string | null }
): string => {
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
        case 'browser':
            return state.addStandaloneView({ kind, name: title, url: url ?? 'https://www.google.com' });
        case 'chat':
            return state.addStandaloneView({ kind, name: title, node: folder });
        case 'terminal':
            return state.addStandaloneView({ kind, name: title, node: command ? { command, ...folder } : folder });
        case 'device':
            if (device === null) {
                throw new ActionRefusal('missing-device', 'Name the device a device view shows.');
            }
            return state.addStandaloneView({ kind, name: title, device });
    }
};

const sessionOf = (resume: string | null | undefined, cwd: string | null | undefined): AgentSession => ({
    ...(resume == null ? {} : { resume }),
    ...(cwd == null ? {} : { cwd })
});

/* A session goes on only in the CLI that started it, so a resume without one names nothing to run. */
const refuseResumeWithout = (resume: string | null | undefined, provider: AgentKind | null): void => {
    if (resume != null && provider === null) {
        throw new ActionRefusal('missing-provider', 'Name the CLI whose session goes on.');
    }
};

export interface ClientActionMachine {
    sendChat(chatId: string, text: string, extras: ChatSendExtras): Promise<{ queued: boolean; turnId?: string }>;
    clearChat(chatId: string, force: boolean): Promise<void>;
    clearTerminal(terminalId: string): void;
    /* The agent CLIs of the machine the project runs on. */
    providers(): readonly ProviderInfo[];
    /* A drawing or diagram keeps what it holds in a file of its own, which the daemon copies. */
    copyViewContent(kind: 'drawing' | 'diagram', from: string, to: string): void;
    viewDeletion: ViewDeletionMachine;
    developer: Partial<DeveloperMachine>;
    sessions: Partial<SessionMachine>;
    content: Partial<ContentMachine>;
    files: Partial<FilesMachine>;
    pages: Partial<PageMachine>;
    projects: Partial<ProjectMachine>;
    machine: Partial<MachineReach>;
}

const LIVE_MACHINE: ClientActionMachine = {
    sendChat: (chatId, text, extras) => chatClient.send(chatId, text, extras),
    clearChat: (chatId, force) => chatClient.clear(chatId, force),
    clearTerminal: (terminalId) => sessionClient.clear(terminalId),
    providers: () => providersOf(currentEndpointId()).providers,
    copyViewContent: (kind, from, to) => void (kind === 'drawing' ? drawingClient.copy(from, to) : diagramClient.copy(from, to)),
    viewDeletion: liveViewDeletion,
    developer: {},
    sessions: {},
    content: {},
    files: {},
    pages: {},
    projects: {},
    machine: {}
};

export const createClientActionRegistry = (document: StoreApi<DocumentState>, machine: Partial<ClientActionMachine> = {}): ActionRegistry<void> => {
    const { sendChat, clearChat, clearTerminal, providers, copyViewContent, viewDeletion, developer, sessions, content, files, pages, projects } = {
        ...LIVE_MACHINE,
        ...machine
    };
    const handlers: ActionHandlers<void> = {
        ...inspectionActions(document),
        ...developerActions(document, developer),
        ...sessionActions(document, sessions),
        ...contentActions(document, content),
        ...filesActions(files),
        ...pageActions(document, pages),
        ...projectActions(document, projects),
        ...machineActions(machine.machine),
        'target.resolve': (input) => ({ output: resolveTarget(document, input) }),
        'workspace.inspect': () => {
            const state = document.getState();
            const active = activeViewOf(state);
            const current = active && isCanvasView(active) ? focusedCanvas().getState() : null;
            const inSight = current === null ? new Set<string>() : new Set(visibleNodes(sightOf(current), { readable: false }));
            return {
                output: {
                    project: useProject.getState().current?.name ?? 'Untitled project',
                    revision: useProject.getState().rev,
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
                    cells: cellsOf(state),
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
        'view.create': ({ kind, name, url, command, path, provider, device, resume, cwd }) => {
            refuseResumeWithout(resume, provider);
            const agent = agentFor(providers(), kind, provider, command);
            const state = document.getState();
            const title = kind === 'separator' ? VIEW_BASE_NAMES.separator : (name ?? agent?.info.name ?? derivedViewName(state, kind, { url, path, device }));
            const viewId =
                agent === null
                    ? addViewOf(state, kind, title, { url, command, path, device: device ?? null, cwd: cwd ?? null })
                    : addAgentView(agent.target, agent.info, title, sessionOf(resume, cwd));
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
        'node.focus': ({ viewId, nodeId }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
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
            const node = nodeToName(document, viewId, nodeId);
            if (!node || isUnknownNode(node)) {
                throw new ActionRefusal('unknown-node', `No renameable node with id “${nodeId}” exists on this canvas.`);
            }
            const previousName = node.title;
            const previousSource = node.titleSource ?? null;
            document.getState().renameNodeOnView(viewId, nodeId, name);
            const changed = nodeToName(document, viewId, nodeId)?.title === name && (previousName !== name || previousSource !== 'user');
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
                              const current = nodeToName(document, viewId, nodeId);
                              if (!current || current.title !== name || current.titleSource !== 'user') {
                                  throw new ActionRefusal('stale-undo', `“${name}” is no longer the current name of this node.`);
                              }
                              document.getState().renameNodeOnView(viewId, nodeId, previousName, previousSource);
                          }
                      }
                    : {})
            };
        },
        'node.create': ({ viewId, kind, title, content, url, command, path, provider, at, cwd, resume }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            refuseResumeWithout(resume, provider);
            const agent = agentFor(providers(), kind, provider, command);
            if (kind === 'file' && path === null) {
                throw new ActionRefusal('missing-path', 'Name the file a file node shows.');
            }
            const depth = canvas.past.length;
            const options: AddNodeOptions = {
                ...(agent === null ? {} : agentNodeOptions(agent.target, agent.info, sessionOf(resume, cwd))),
                ...(agent === null && cwd != null && (kind === 'chat' || kind === 'terminal') ? { cwd } : {}),
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
                canvasNow(document, viewId).updateNode(nodeId, { body: content });
            }
            const node = canvasNow(document, viewId).nodes[nodeId]!;
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
            const { view, canvas } = canvasOnScreen(document, viewId);
            const source = canvas.nodes[nodeId];
            if (!source || isUnknownNode(source)) {
                throw new ActionRefusal('unknown-node', `No duplicable node with id “${nodeId}” exists on this canvas.`);
            }
            const depth = canvas.past.length;
            canvas.duplicateNode(nodeId);
            const copyId = canvasNow(document, viewId).selection[0];
            const copy = copyId ? canvasNow(document, viewId).nodes[copyId] : undefined;
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
            const { view, canvas } = canvasOnScreen(document, viewId);
            const names = nodeIds.map((id) => canvas.nodes[id]?.title ?? canvas.texts[id]?.text);
            const missing = nodeIds.find((_id, index) => names[index] === undefined);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node or text with id “${missing}” exists on “${view.name}”.`);
            }
            canvas.select([...nodeIds]);
            return { output: { viewId, view: view.name, nodeIds, nodes: names.map((name) => name!) } };
        },
        'node.delete': async ({ viewId, nodeIds }, { confirmed }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
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
            const current = canvasNow(document, viewId);
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
            const { view, canvas } = canvasOnScreen(document, viewId);
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
        'link.create': ({ viewId, from, to }) => {
            if (from === null) {
                throw new ActionRefusal('missing-from', 'Name the node the line starts from.');
            }
            const { canvas } = canvasOnScreen(document, viewId);
            const targets = [...new Set(to)];
            const missing = [from, ...targets].find((id) => !canvas.nodes[id]);
            if (missing) {
                throw new ActionRefusal('unknown-node', `No node with id “${missing}” exists on this canvas.`);
            }
            if (targets.includes(from)) {
                throw new ActionRefusal('self-link', 'A line runs between two nodes, and this one names the same node at both ends.');
            }
            const depth = canvas.past.length;
            const before = new Set(canvas.edges.map((edge) => edge.id));
            for (const target of targets) {
                canvasNow(document, viewId).addEdge(from, target);
            }
            const after = canvasNow(document, viewId);
            const lineOf = (tail: string, head: string) => after.edges.find((edge) => edge.from === tail && edge.to === head);
            const edges = targets.flatMap((target) => {
                const out = lineOf(from, target)!;
                const back = lineOf(target, from);
                return [
                    { edgeId: out.id, from, to: target, state: before.has(out.id) ? ('existing' as const) : ('new' as const), way: 'out' as const },
                    ...(back === undefined || before.has(back.id)
                        ? []
                        : [{ edgeId: back.id, from: target, to: from, state: 'new' as const, way: 'back' as const }])
                ];
            });
            const steps = after.past.length - depth;
            return {
                output: { viewId, edges },
                ...(steps === 0 ? {} : { undo: historyUndo(viewId, depth + steps, undefined, steps) })
            };
        },
        'canvas.fit': ({ viewId }) => {
            const { view, editor } = editorOnScreen(document, viewId, 'fitting it in view');
            editor().fitAll();
            return { output: { viewId, view: view.name } };
        },
        'history.undo': ({ viewId }) => {
            const { view, editor } = editorOnScreen(document, viewId, 'undoing or redoing a change in it');
            const before = editor().past.length;
            editor().undo();
            return { output: { viewId, view: view.name, changed: editor().past.length !== before } };
        },
        'history.redo': ({ viewId }) => {
            const { view, editor } = editorOnScreen(document, viewId, 'undoing or redoing a change in it');
            const before = editor().future.length;
            editor().redo();
            return { output: { viewId, view: view.name, changed: editor().future.length !== before } };
        },
        'canvasText.create': ({ viewId, text, at }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
            const depth = canvas.past.length;
            const textId = canvas.addText(at ?? centerWorld(canvas));
            if (text !== null) {
                const written = canvasNow(document, viewId);
                written.updateText(textId, text);
                written.setEditingText(null);
            }
            return {
                output: { viewId, view: view.name, textId },
                undo: historyUndo(viewId, depth + 1, (current) => current.texts[textId] !== undefined)
            };
        },
        'node.promoteToView': ({ viewId, nodeId }, { confirmed }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
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
            const { view, canvas } = canvasOnScreen(document, viewId);
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
        'view.move': ({ viewId, afterViewId }) => {
            const state = document.getState();
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw unknownView(viewId);
            }
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
            const view = state.views.find((candidate) => candidate.id === viewId);
            if (!view) {
                throw unknownView(viewId);
            }
            if (!isOpenableView(view) || isUnknownView(view)) {
                throw new ActionRefusal('not-markable', `“${view.name ?? viewId}” divides the sidebar and has no room for a mark.`);
            }
            if (icon !== null && !(PROJECT_ICON_NAMES as readonly string[]).includes(icon)) {
                throw new ActionRefusal('unknown-icon', `“${icon}” is not one of the Lucide names the picker has.`);
            }
            const previous = viewIconOf(view);
            const next: ProjectIconChoice | null = icon === null ? null : { kind: 'lucide', value: icon as ProjectIconChoice['value'] };
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
            const views = state.exportViews();
            const flagged = [...new Set(ids)].map((id) => {
                const target = views.some((view) => view.id === id)
                    ? ('view' as const)
                    : views.some((view) => isCanvasView(view) && view.nodes.some((node) => node.id === id))
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
        },
        'layout.save': ({ viewId, name }, { confirmed }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
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
            const saved = canvasNow(document, viewId).layouts.find((layout) => layout.name === name);
            return {
                output: { viewId, view: view.name, name, replaced: previous !== null },
                undo: () => {
                    const current = canvasNow(document, viewId);
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
            const { view, canvas } = canvasOnScreen(document, viewId);
            if (!canvas.layouts.some((layout) => layout.name === name)) {
                throw new ActionRefusal('unknown-layout', `“${view.name}” has no layout saved as “${name}”.`);
            }
            const depth = canvas.past.length;
            canvas.applyLayout(name);
            return { output: { viewId, view: view.name, name }, undo: historyUndo(viewId, depth + 1) };
        },
        'layout.delete': ({ viewId, name }, { confirmed }) => {
            const { view, canvas } = canvasOnScreen(document, viewId);
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
                    const current = canvasNow(document, viewId);
                    if (current.layouts.some((candidate) => candidate.name === name)) {
                        throw new ActionRefusal('stale-undo', `A layout called “${name}” was saved again after this action.`);
                    }
                    current.putLayout(layout);
                }
            };
        },
        'canvas.setLocks': ({ viewId, locked, gestures }) => {
            const { view } = canvasOnScreen(document, viewId);
            for (const key of gestures ?? LOCK_KEYS) {
                const current = canvasNow(document, viewId);
                if (current.locks[key] !== locked) {
                    current.toggleLock(key);
                }
            }
            const locks: Locks = canvasNow(document, viewId).locks;
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
        'split.placeView': ({ viewId, paths, cellViewId, zone }, call) => {
            const state = document.getState();
            const layout = state.layout;
            if (layout === null) {
                throw new ActionRefusal('no-grid', 'No view is open.');
            }
            if ((viewId === null) === (paths === null)) {
                throw new ActionRefusal('view-or-files', 'Name a view or files, one of the two.');
            }
            const at = cellViewId === null ? layout.focus : locateView(layout, cellViewId);
            const standing = at === null ? null : cellAt(layout, at);
            if (at === null || standing === null) {
                throw new ActionRefusal('view-not-shown', `“${cellName(state, cellViewId ?? '')}” does not stand in a cell.`);
            }
            if (viewId !== null) {
                const view = state.views.find((candidate) => candidate.id === viewId);
                if (viewId !== FILES_VIEW_ID && (!view || !isOpenableView(view))) {
                    throw unknownView(viewId);
                }
            }
            const folder = useProject.getState().current?.folder ?? null;
            // Every path is checked before the first view is made, so a refusal leaves the sidebar as it was.
            const stored = (paths ?? []).map((path) => storedPathOf(folder, projectPathOf(folder, path, call.actor.kind)));
            if (!canSplit(layout, at, zone, viewId)) {
                throw new ActionRefusal('no-room', 'The grid has no room there, or the view already stands in that cell.');
            }
            // A file of its own, not a tab: every path becomes a view the sidebar lists, and the first takes the place.
            const created = stored.map((path) => state.addFileView(basenameOf(path), path, false));
            const target = viewId ?? created[0]!;
            document.getState().dropViewAt(target, at, zone);
            return { output: { viewId: target, view: cellName(document.getState(), target), cellViewId: standing.viewId, zone, created } };
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
        'chat.send': async ({ chatId, prompt, mentions, skills, chats, attachments }, call) => {
            const chat = sessionTitle(document, chatId, 'chat');
            if (!chat) {
                throw new ActionRefusal('unknown-chat', `No AI Chat with id “${chatId}” exists in this project.`);
            }
            const text = call.actor.kind === 'person' ? prompt : prompt.trim();
            if (text.trim() === '' && (attachments ?? []).length === 0) {
                throw new ActionRefusal('empty-prompt', 'A message needs text or an attachment.');
            }
            try {
                const submitted = await sendChat(chatId, text, {
                    ...(mentions == null ? {} : { mentions }),
                    ...(skills == null ? {} : { skills }),
                    ...(chats == null ? {} : { chats }),
                    ...(attachments == null ? {} : { attachments })
                });
                return { output: { chatId, chat, ...submitted } };
            } catch (error: unknown) {
                throw asRefusal(error);
            }
        },
        'chat.clear': async ({ chatId, force }, call) => {
            const chat = sessionTitle(document, chatId, 'chat');
            if (!chat) {
                throw new ActionRefusal('unknown-chat', 'This AI Chat no longer exists in the current project.');
            }
            if (asksFirst(call)) {
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
            try {
                // Anyone but a person already said yes to stopping a turn in the way; a person's composer asks on chat-busy.
                await clearChat(chatId, call.actor.kind === 'person' ? force === true : true);
            } catch (error: unknown) {
                throw asRefusal(error);
            }
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
    };
    return new ActionRegistry<void>(handlers, { checkRevision: checkClientRevision });
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
export const runAsPerson = async <Name extends ActionName>(name: Name, input: ActionInput<Name>): Promise<ActionOutput<Name> | null> => {
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

/*
 * For a surface that says itself how an action went, such as a toast of the git panel: the output, or
 * the refusal thrown with the machine's own code, so a diverged branch still reads apart from a failure.
 */
export const performAsPerson = async <Name extends ActionName>(name: Name, input: ActionInput<Name>): Promise<ActionOutput<Name>> => {
    const result = await clientActions.execute(name, input, PERSON_ACTION_CALL);
    if (result.status === 'failed') {
        throw new ActionRefusal(result.error.code, result.error.message, result.error.details);
    }
    if (result.status === 'needs_confirmation') {
        throw new ActionRefusal('confirmation-required', `“${name}” asked a person for a confirmation their own dialog should have given.`);
    }
    return result.output;
};

/* `performAsPerson` for an action whose question the person's own dialog already answered. */
export const performConfirmedAsPerson = async <Name extends ActionName>(name: Name, input: ActionInput<Name>): Promise<ActionOutput<Name>> => {
    const asked = await clientActions.execute(name, input, PERSON_ACTION_CALL);
    const result = asked.status === 'needs_confirmation' ? await clientActions.confirm(asked.confirmationToken, true, PERSON_ACTION_CALL) : asked;
    if (result.status === 'failed') {
        throw new ActionRefusal(result.error.code, result.error.message, result.error.details);
    }
    if (result.status === 'needs_confirmation') {
        throw new ActionRefusal('confirmation-loop', `“${name}” asked a second time.`);
    }
    return result.output as ActionOutput<Name>;
};

/* The prompt cards answer as the person whose click it was, through the actions Voice asks for too. */
export const PERSON_PROMPT_CLIENTS: PromptClients = {
    chat: {
        approve: async (chatId, requestId, decision, message) => {
            await performAsPerson('chat.approve', { chatId, requestId, decision, message: message ?? null });
        },
        answer: async (chatId, requestId, answers) => {
            await performAsPerson('chat.answer', {
                chatId,
                requestId,
                answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }))
            });
        },
        dismiss: async (chatId, itemId) => {
            await performAsPerson('chat.dismissQuestion', { chatId, itemId });
        }
    },
    computer: {
        answer: async (requestId, choice) => (await performAsPerson('computer.answerApproval', { requestId, choice })).accepted
    }
};

const activeViewId = (): string | null => useDocument.getState().activeViewId;

export const focusViewAction = (viewId: string): void => {
    void runAsPerson('view.focus', { viewId });
};

export const renameViewAction = (viewId: string, name: string): void => {
    void runAsPerson('view.rename', { viewId, name });
};

/* A name carried over from something that already has one may predate the limit; it is cut, never refused. */
const carriedName = (name: string | undefined): string | null => (name === undefined ? null : name.trim().slice(0, MAX_TITLE_LENGTH) || null);

export interface CreateViewOptions extends AgentSession {
    name?: string;
    url?: string;
    path?: string;
    provider?: AgentKind;
    device?: DeviceReference;
}

/* Resolves the id of the new view, or null when there is none. */
export const createViewAction = async (kind: CreatableViewKind, options: CreateViewOptions = {}): Promise<string | null> => {
    const created = await runAsPerson('view.create', {
        kind,
        name: carriedName(options.name),
        url: options.url ?? null,
        command: null,
        path: options.path ?? null,
        provider: options.provider ?? null,
        device: options.device ?? null,
        resume: options.resume ?? null,
        cwd: options.cwd ?? null
    });
    return created?.viewId ?? null;
};

/* Null puts the view at the top of the list. */
export const moveViewAction = async (viewId: string, afterViewId: string | null): Promise<void> => {
    await runAsPerson('view.move', { viewId, afterViewId });
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

export const colorNoteAction = (viewId: string | null, nodeId: string, color: NoteColor): void => {
    if (viewId !== null) {
        void runAsPerson('note.setColor', { viewId, nodeId, color });
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
 * The action names nodes and nothing else. A pick that also holds text or a line goes to its own store
 * in one step, so a single undo still brings all of it back.
 */
export const deleteNodesAction = (store: StoreApi<CanvasState>, ids: readonly string[]): void => {
    const canvas = store.getState();
    if (canvas.viewId !== null && defaultCanvases.peek(canvas.viewId) === store && ids.length > 0 && ids.every((id) => canvas.nodes[id] !== undefined)) {
        void runConfirmedAsPerson('node.delete', { viewId: canvas.viewId, nodeIds: [...ids] });
        return;
    }
    canvas.select([...ids]);
    canvas.deleteSelected();
};

export const fitAction = (viewId: string | null = activeViewId()): void => {
    if (viewId !== null) {
        void runAsPerson('canvas.fit', { viewId });
    }
};

export interface CreateNodeOptions extends AgentSession {
    /* The canvas it goes on, when that is not the one in the focused cell. */
    viewId?: string | null;
    title?: string;
    url?: string;
    provider?: AgentKind;
    path?: string;
    /* The node's middle in world units, which a click or a drop knows and a menu does not. */
    at?: Point;
}

/* On the canvas on screen, at `at` or in free space near the middle of what it shows. Resolves the new node's id. */
export const createNodeAction = async (kind: CreatableNodeKind, options: CreateNodeOptions = {}): Promise<string | null> => {
    const viewId = options.viewId ?? activeViewId();
    if (viewId === null) {
        return null;
    }
    const created = await runAsPerson('node.create', {
        viewId,
        kind,
        title: carriedName(options.title),
        content: null,
        url: options.url ?? null,
        command: null,
        path: options.path ?? null,
        provider: options.provider ?? null,
        at: options.at ?? null,
        resume: options.resume ?? null,
        cwd: options.cwd ?? null
    });
    return created?.nodeId ?? null;
};

export const linkNodesAction = async (viewId: string, from: string, to: string): Promise<void> => {
    await runAsPerson('link.create', { viewId, from, to: [to] });
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

export const historyAction = (step: 'undo' | 'redo', viewId: string | null = activeViewId()): void => {
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

/* A drop on a cell: `cellViewId` is the view standing in the cell it landed on. */
export const placeViewAction = (viewId: string, cellViewId: string, zone: SplitZone): void => {
    void runAsPerson('split.placeView', { viewId, paths: null, cellViewId, zone });
};

export const placeFilesAction = (paths: readonly string[], cellViewId: string, zone: SplitZone): void => {
    if (paths.length > 0) {
        void runAsPerson('split.placeView', { viewId: null, paths: [...paths], cellViewId, zone });
    }
};

/*
 * Everything on the canvas, text included. Like a delete, a store that is not the canvas's own editor
 * (a canvas shown inside another view) selects in place.
 */
export const selectAllAction = (store: StoreApi<CanvasState>): void => {
    const canvas = store.getState();
    const ids = [...canvas.order, ...Object.keys(canvas.texts)];
    if (canvas.viewId !== null && defaultCanvases.peek(canvas.viewId) === store && ids.length > 0) {
        void runAsPerson('canvas.select', { viewId: canvas.viewId, nodeIds: ids });
        return;
    }
    canvas.select(ids);
};

/* The switch screen says how an open goes, so a refusal here stays quiet like every other person's action. */
export const openProjectAction = (endpointId: string, projectId: string): void => {
    void runAsPerson('project.switch', { endpointId, projectId });
};

export const openFolderAction = (endpointId: string, folder: string, createFolder: boolean): void => {
    void runAsPerson('project.create', { endpointId, folder, createFolder });
};

/* The cancel button of a git run: the run is named by the id its progress streams under. */
export const cancelGitRunAction = (runId: string): void => {
    void runAsPerson('operation.cancel', { operationId: `${GIT_OPERATION}${runId}` });
};

/* Null takes the mark away. */
export const setViewIconAction = (viewId: string, icon: ProjectIconChoice | null): void => {
    void runAsPerson('view.setIcon', { viewId, icon: icon?.value ?? null });
};

/* A color a person picks is the one the shortcut sets next; null takes the flags off. */
export const flagAction = (ids: readonly string[], color: NodeAccent | null): void => {
    if (color !== null) {
        rememberFlagColor(color);
    }
    void runAsPerson('flag.set', { ids: [...ids], color });
};

/*
 * What the shortcut flags: the nodes selected on the canvas with the focus, else the view in the
 * focused cell. Flagged all over it takes the flags off; otherwise it flags the lot in the last color.
 */
export const toggleFlagAction = (): void => {
    const state = useDocument.getState();
    const view = activeViewOf(state);
    if (view === null) {
        return;
    }
    const selection = isCanvasView(view) ? focusedCanvas().getState().selection : [];
    const ids = selection.length > 0 ? selection : [view.id];
    const flagged = ids.every((id) => flagOf(state.flags, id) !== null);
    void runAsPerson('flag.set', { ids, color: flagged ? null : lastFlagColor() });
};

/* A person's key or menu row is the answer, as a terminal's own Cmd+K always was. */
export const clearTerminalAction = (terminalId: string): void => {
    void runConfirmedAsPerson('terminal.clear', { terminalId });
};

/* The body rebuilds its terminal once the fresh session is asked for; the action only asks. */
export const restartTerminalAction = (terminalId: string): void => {
    void runAsPerson('terminal.restart', { terminalId });
};

export const resumeTerminalAgentAction = (terminalId: string): void => {
    void runAsPerson('terminal.resumeAgent', { terminalId });
};
