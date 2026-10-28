import { messageOf } from '@adecore/ui';
import { terminalPrepareActions } from '@/actions/terminal-prepare-actions';
import i18next from 'i18next';
import { useToasts } from '@/state/toasts';
import { contentActions, type ContentMachine } from '@/actions/content-actions';
import { chatSearchActions, type ChatSearchMachine } from '@/actions/chat-search-actions';
import { databaseActions, type DatabaseMachine } from '@/actions/database-actions';
import { asksFirst, developerActions, GIT_OPERATION, type DeveloperMachine } from '@/actions/developer-actions';
import { refusing } from '@/actions/refusal';
import { filesActions, type FilesMachine } from '@/actions/files-actions';
import { inspectionActions } from '@/actions/inspection-actions';
import { launchActions, type LaunchReach } from '@/actions/launch-actions';
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
    clipText,
    flagOf,
    isCanvasView,
    isOpenableView,
    type AgentKind,
    type ChatItem,
    type ComputerApprovalChoice,
    type DeviceReference,
    type NodeAccent,
    type ProjectIconChoice,
    type ProviderInfo
} from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import type { AgentSession } from '@/agents/nodes';
import type { Point } from '@/canvas/math';
import type { ChatSendExtras } from '@adecore/agents-react/chat';
import { recentChatMessages } from '@adecore/agents-react/chat';
import { liveViewDeletion, type ViewDeletionMachine } from '@/project/view-deletion';
import { nodesOfView } from '@/project/view-nodes';
import { lastFlagColor, rememberFlagColor } from '@/project/flag-color';
import { openInNewWindow, wantsNewWindow } from '@/project/windows';
import type { ChatPromptClients } from '@adecore/agents-react/prompts';
import type { CellAt, SplitDirection, SplitZone } from '@/shell/split';
import { defaultCanvases, focusedCanvas, type CanvasState, type Locks } from '@/state/canvas';
import { useChats, providersOf } from '@adecore/agents-react/state';
import { activeViewOf, useDocument, viewOfNode, type DocumentState } from '@/state/document';
import { closeCellsRightOfGuarded, closeOtherCellsGuarded } from '@/state/cell-close';
import { closeTabGuarded, closeTabsAround, type TabsClosing } from '@/state/tab-close';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { shownFolderOf, useProject } from '@/state/project';
import { designFoldersOnDisk } from '@/design/design-read';
import { chatClient, chatClientFor, diagramClient, drawingClient, sessionClient, sessionClientFor } from '@/transport/connections';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { canvasActions } from '@/actions/canvas-actions';
import { layoutActions } from '@/actions/layout-actions';
import { viewActions } from '@/actions/view-actions';
import type { CreatableNodeKind, CreatableViewKind } from '@/actions/action-reach';

export interface ClientActionMachine {
    sendChat(chatId: string, text: string, extras: ChatSendExtras): Promise<{ queued: boolean; turnId?: string }>;
    clearChat(chatId: string, force: boolean): Promise<void>;
    /* The thread of a chat nobody in this window opened, read without attaching to it for good. */
    inspectChat(chatId: string): Promise<{ items: ChatItem[] }>;
    clearTerminal(terminalId: string): void;
    /* The agent CLIs of the machine the project runs on. */
    providers(): readonly ProviderInfo[];
    /* A drawing or diagram keeps what it holds in a file of its own, which the daemon copies. */
    copyViewContent(kind: 'drawing' | 'diagram', from: string, to: string): void;
    /* The folders under `designs/` of the project on disk, as stored paths, so a new design takes a folder of its own. */
    designFolders(): Promise<readonly string[]>;
    viewDeletion: ViewDeletionMachine;
    developer: Partial<DeveloperMachine>;
    sessions: Partial<SessionMachine>;
    content: Partial<ContentMachine>;
    files: Partial<FilesMachine>;
    database: Partial<DatabaseMachine>;
    chatSearch: Partial<ChatSearchMachine>;
    pages: Partial<PageMachine>;
    projects: Partial<ProjectMachine>;
    machine: Partial<MachineReach>;
    launches: Partial<LaunchReach>;
}

const LIVE_MACHINE: ClientActionMachine = {
    sendChat: (chatId, text, extras) => (chatClientFor(endpointOfNodeId(chatId)) ?? chatClient).send(chatId, text, extras),
    clearChat: (chatId, force) => (chatClientFor(endpointOfNodeId(chatId)) ?? chatClient).clear(chatId, force),
    inspectChat: (chatId) => (chatClientFor(endpointOfNodeId(chatId)) ?? chatClient).inspect(chatId),
    clearTerminal: (terminalId) => (sessionClientFor(endpointOfNodeId(terminalId)) ?? sessionClient).clear(terminalId),
    providers: () => providersOf(currentEndpointId()).providers,
    copyViewContent: (kind, from, to) => void (kind === 'drawing' ? drawingClient.copy(from, to) : diagramClient.copy(from, to)),
    designFolders: () => designFoldersOnDisk(currentEndpointId(), shownFolderOf(useProject.getState().current)),
    viewDeletion: liveViewDeletion,
    developer: {},
    sessions: {},
    content: {},
    files: {},
    database: {},
    chatSearch: {},
    pages: {},
    projects: {},
    machine: {},
    launches: {}
};

export function createClientActionRegistry(document: StoreApi<DocumentState>, machine: Partial<ClientActionMachine> = {}): ActionRegistry<void> {
    const {
        sendChat,
        clearChat,
        inspectChat,
        clearTerminal,
        providers,
        copyViewContent,
        designFolders,
        viewDeletion,
        developer,
        sessions,
        content,
        files,
        database,
        chatSearch,
        pages,
        projects,
        machine: machineReach,
        launches
    } = {
        ...LIVE_MACHINE,
        ...machine
    };
    const handlers: ActionHandlers<void> = {
        ...terminalPrepareActions(),
        ...inspectionActions(document),
        ...developerActions(document, developer),
        ...sessionActions(document, sessions),
        ...contentActions(document, content),
        ...filesActions(files),
        ...databaseActions(database),
        ...chatSearchActions(chatSearch),
        ...pageActions(document, pages),
        ...projectActions(document, projects),
        ...machineActions(machineReach),
        ...launchActions(launches),
        ...canvasActions(document, { providers, viewDeletion }),
        ...viewActions(document, { providers, viewDeletion, copyViewContent, designFolders }),
        ...layoutActions(document),
        'target.resolve': (input) => ({ output: resolveTarget(document, input) }),
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
        'chat.send': async ({ chatId, prompt, delivery, mentions, skills, chats, quoteSource, attachments, references }, call) => {
            const chat = sessionTitle(document, chatId, 'chat');
            if (!chat) {
                throw new ActionRefusal('unknown-chat', `No AI Chat with id “${chatId}” exists in this project.`);
            }
            const text = call.actor.kind === 'person' ? prompt : prompt.trim();
            if (text.trim() === '' && (attachments ?? []).length === 0) {
                throw new ActionRefusal('empty-prompt', 'A message needs text or an attachment.');
            }
            const submitted = await refusing(
                sendChat(chatId, text, {
                    ...(delivery == null ? {} : { delivery }),
                    ...(mentions == null ? {} : { mentions }),
                    ...(skills == null ? {} : { skills }),
                    ...(chats == null ? {} : { chats }),
                    ...(quoteSource == null ? {} : { quoteSource }),
                    ...(attachments == null ? {} : { attachments }),
                    ...(references == null ? {} : { references })
                })
            );
            return { output: { chatId, chat, ...submitted } };
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
            // Anyone but a person already said yes to stopping a turn in the way; a person's composer asks on chat-busy.
            await refusing(clearChat(chatId, call.actor.kind === 'person' ? force === true : true));
            return { output: { chatId, chat } };
        },
        'chat.read': async ({ chatId, limit }) => {
            const chat = sessionTitle(document, chatId, 'chat');
            if (!chat) {
                throw new ActionRefusal('unknown-chat', `No AI Chat with id “${chatId}” exists in this project.`);
            }
            const state = useChats.getState().byKey[endpointKey(endpointOfNodeId(chatId), chatId)];
            if (state) {
                return { output: { chatId, chat, ...recentChatMessages(state.items, state.order, limit ?? 20) } };
            }
            // Voice says the rest of a long answer is a read away, also of a chat on a view nobody opened.
            const { items } = await refusing(inspectChat(chatId));
            const byId = Object.fromEntries(items.map((item) => [item.id, item]));
            return {
                output: {
                    chatId,
                    chat,
                    ...recentChatMessages(
                        byId,
                        items.map((item) => item.id),
                        limit ?? 20
                    )
                }
            };
        }
    };
    return new ActionRegistry<void>(handlers, { checkRevision: checkClientRevision });
}

export const clientActions = createClientActionRegistry(useDocument);

export const PERSON_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'person', id: 'local-person' },
    context: undefined
};
export const VOICE_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'voice', id: 'voice-session' },
    context: undefined
};

export interface PerformOptions {
    /* The person already answered the app's own dialog before this runs, so the action's question is theirs to answer. */
    confirmed?: boolean;
}

/*
 * Runs an action as the person at this window. Throws the refusal with the machine's own code, so a
 * surface that says how it went can tell a diverged branch from a failure.
 */
export async function perform<Name extends ActionName>(name: Name, input: ActionInput<Name>, options: PerformOptions = {}): Promise<ActionOutput<Name>> {
    return performIn(clientActions, name, input, options);
}

export async function performIn<Name extends ActionName>(
    registry: ActionRegistry<void>,
    name: Name,
    input: ActionInput<Name>,
    { confirmed = false }: PerformOptions = {}
): Promise<ActionOutput<Name>> {
    const asked = await registry.execute(name, input, PERSON_ACTION_CALL);
    if (asked.status === 'needs_confirmation' && !confirmed) {
        throw new ActionRefusal('confirmation-required', `“${name}” asked a person for a confirmation their own dialog should have given.`);
    }
    const result = asked.status === 'needs_confirmation' ? await registry.confirm(asked.confirmationToken, true, PERSON_ACTION_CALL) : asked;
    if (result.status === 'failed') {
        throw new ActionRefusal(result.error.code, result.error.message, result.error.details);
    }
    if (result.status === 'needs_confirmation') {
        throw new ActionRefusal('confirmation-loop', `“${name}” asked a second time.`);
    }
    return result.output as ActionOutput<Name>;
}

/* A person sees what happened on screen, so a surface that says nothing itself catches a refusal with this. */
export function ignoreRefusal(): null {
    return null;
}

/* The prompt cards answer as the person whose click it was, through the actions Voice asks for too. */
export const PERSON_PROMPT_CLIENTS: ChatPromptClients = {
    approve: async (chatId, requestId, decision, message) => {
        await perform('chat.approve', { chatId, requestId, decision, message: message ?? null });
    },
    answer: async (chatId, requestId, answers) => {
        await perform('chat.answer', {
            chatId,
            requestId,
            answers: Object.entries(answers).map(([questionId, answer]) => ({ questionId, answer }))
        });
    },
    dismiss: async (chatId, itemId) => {
        await perform('chat.dismissQuestion', { chatId, itemId });
    }
};

/* The machine's own card about operating an app, answered the same way; false when it no longer waited. */
export async function answerComputerAsPerson(requestId: string, choice: ComputerApprovalChoice): Promise<boolean> {
    return (await perform('computer.answerApproval', { requestId, choice })).accepted;
}

function activeViewId(): string | null {
    return useDocument.getState().activeViewId;
}

export function focusViewAction(viewId: string): void {
    void perform('view.focus', { viewId }).catch(ignoreRefusal);
}

/*
 * A view of the project opened beside the one in the focused cell, as a tab. Not an action of the catalog: only a
 * person at a grid asks for this. The banner over the views says so and offers the way back, as for any show.
 */
export function openInNewTabAction(viewId: string): void {
    const state = useDocument.getState();
    const view = state.views.find((candidate) => candidate.id === viewId);
    const shown = view === undefined || !isOpenableView(view) ? null : state.showView(viewId, { newTab: true });
    if (view !== undefined && shown?.tab !== undefined) {
        useDocument.getState().showNotice({
            message: i18next.t('project:showView.newTab', { view: view.name ?? viewId }),
            action: { kind: 'back', shown }
        });
    }
}

export function renameViewAction(viewId: string, name: string): void {
    void perform('view.rename', { viewId, name }).catch(ignoreRefusal);
}

/* A name carried over from something that already has one may predate the limit; it is cut, never refused. */
function carriedName(name: string | undefined): string | null {
    return name === undefined ? null : clipText(name.trim(), MAX_TITLE_LENGTH) || null;
}

export interface CreateViewOptions extends AgentSession {
    name?: string;
    url?: string;
    browserOwner?: string;
    path?: string;
    provider?: AgentKind;
    device?: DeviceReference;
}

export async function createViewAction(kind: CreatableViewKind, options: CreateViewOptions = {}): Promise<string | null> {
    const created = await perform('view.create', {
        kind,
        name: carriedName(options.name),
        url: options.url ?? null,
        browserOwner: options.browserOwner ?? null,
        command: null,
        path: options.path ?? null,
        provider: options.provider ?? null,
        account: options.account ?? null,
        device: options.device ?? null,
        resume: options.resume ?? null,
        cwd: options.cwd ?? null
    }).catch(ignoreRefusal);
    return created?.viewId ?? null;
}

/* Null puts the view at the top of the list. */
export async function moveViewAction(viewId: string, afterViewId: string | null): Promise<void> {
    await perform('view.move', { viewId, afterViewId }).catch(ignoreRefusal);
}

export function deleteViewAction(viewId: string): void {
    void perform('view.delete', { viewId }, { confirmed: true }).catch(ignoreRefusal);
}

export function duplicateViewAction(viewId: string): void {
    void perform('view.duplicate', { viewId }).catch(ignoreRefusal);
}

export function placeViewOnCanvasAction(viewId: string, canvasViewId: string | null = null): void {
    void perform('view.placeOnCanvas', { viewId, canvasViewId }).catch(ignoreRefusal);
}

export async function showViewOnCanvasAction(viewId: string): Promise<string | null> {
    return (await perform('view.showOnCanvas', { viewId }).catch(ignoreRefusal))?.nodeId ?? null;
}

/* Resolves how to take it back, or null when nothing happened. */
export async function shareViewAction(viewId: string, shared: boolean): Promise<{ view: string; undo: () => void } | null> {
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
}

export function focusNodeAction(viewId: string | null, nodeId: string): void {
    if (viewId !== null) {
        void perform('node.focus', { viewId, nodeId }).catch(ignoreRefusal);
    }
}

export function duplicateNodeAction(viewId: string | null, nodeId: string): void {
    if (viewId !== null) {
        void perform('node.duplicate', { viewId, nodeId }).catch(ignoreRefusal);
    }
}

export function renameNodeAction(viewId: string | null, nodeId: string, name: string): void {
    if (viewId !== null) {
        void perform('node.rename', { viewId, nodeId, name }).catch(ignoreRefusal);
    }
}

export function colorNodeAction(viewId: string | null, nodeId: string, color: NodeAccent | null): void {
    if (viewId !== null) {
        void perform('node.setColor', { viewId, nodeId, color }).catch(ignoreRefusal);
    }
}

/* The lines a node leaves behind were asked about by the promote dialog, when it had any. */
export function promoteNodeAction(nodeId: string): void {
    const viewId = viewOfNode(useDocument.getState().views, nodesOfView, nodeId)?.id ?? activeViewId();
    if (viewId !== null) {
        void perform('node.promoteToView', { viewId, nodeId }, { confirmed: true }).catch(ignoreRefusal);
    }
}

export function moveNodeToViewAction(nodeId: string, targetViewId: string): void {
    const viewId = activeViewId();
    if (viewId !== null) {
        void perform('node.moveToView', { viewId, nodeId, targetViewId }, { confirmed: true }).catch(ignoreRefusal);
    }
}

/*
 * The action names nodes and nothing else. A pick that also holds text or a line goes to its own store
 * in one step, so a single undo still brings all of it back.
 */
export function deleteNodesAction(store: StoreApi<CanvasState>, ids: readonly string[]): void {
    const canvas = store.getState();
    if (canvas.viewId !== null && defaultCanvases.peek(canvas.viewId) === store && ids.length > 0 && ids.every((id) => canvas.nodes[id] !== undefined)) {
        void perform('node.delete', { viewId: canvas.viewId, nodeIds: [...ids] }, { confirmed: true }).catch(ignoreRefusal);
        return;
    }
    canvas.select([...ids]);
    canvas.deleteSelected();
}

export function fitAction(viewId: string | null = activeViewId()): void {
    if (viewId !== null) {
        void perform('canvas.fit', { viewId }).catch(ignoreRefusal);
    }
}

export interface CreateNodeOptions extends AgentSession {
    /* The canvas it goes on, when that is not the one in the focused cell. */
    viewId?: string | null;
    title?: string;
    /* Notes only: the body it starts with. */
    content?: string;
    url?: string;
    browserOwner?: string;
    provider?: AgentKind;
    /* The account of that CLI; absent is the one the person picked for new agents, else its default. */
    account?: string;
    /* Terminals only: typed in place of the CLI, in the environment of `account`. */
    command?: string;
    path?: string;
    /* The GitHub issue an agent node was started on. */
    issue?: { repo: string; number: number; url: string };
    /* The node's middle in world units, which a click or a drop knows and a menu does not. */
    at?: Point;
    /* Artifacts only: the one it shows. */
    artifact?: string;
    /* Artifacts only: the version it stays on; absent follows the latest. */
    artifactVersion?: string;
    /* Routines only: the routine of the project it shows. */
    routine?: string;
}

/* On the canvas on screen, at `at` or in free space near the middle of what it shows. Resolves the new node's id. */
export async function createNodeAction(kind: CreatableNodeKind, options: CreateNodeOptions = {}): Promise<string | null> {
    const viewId = options.viewId ?? activeViewId();
    if (viewId === null) {
        return null;
    }
    const created = await perform('node.create', {
        viewId,
        kind,
        title: carriedName(options.title),
        content: options.content ?? null,
        url: options.url ?? null,
        browserOwner: options.browserOwner ?? null,
        command: options.command ?? null,
        path: options.path ?? null,
        provider: options.provider ?? null,
        account: options.account ?? null,
        at: options.at ?? null,
        resume: options.resume ?? null,
        cwd: options.cwd ?? null,
        issue: options.issue ?? null,
        artifact: options.artifact ?? null,
        artifactVersion: options.artifactVersion ?? null,
        routine: options.routine ?? null
    }).catch(ignoreRefusal);
    return created?.nodeId ?? null;
}

export async function linkNodesAction(viewId: string, from: string, to: string): Promise<void> {
    await perform('link.create', { viewId, from, to: [to] }).catch(ignoreRefusal);
}

/* Empty and open for typing, the way a double-click on the canvas starts one. */
export function createTextAction(at: Point | null = null): void {
    const viewId = activeViewId();
    if (viewId !== null) {
        void perform('canvasText.create', { viewId, text: null, at }).catch(ignoreRefusal);
    }
}

/* A group never goes inside a new group, so only the other selected nodes become its members. */
export function groupSelectionAction(): void {
    const viewId = activeViewId();
    const { selection, nodes } = focusedCanvas().getState();
    const nodeIds = selection.filter((id) => {
        const node = nodes[id];
        return node !== undefined && node.kind !== 'group';
    });
    if (viewId === null || nodeIds.length === 0) {
        return;
    }
    void perform('group.create', { viewId, nodeIds }).catch(ignoreRefusal);
}

/* A refusal is the answer here: nothing moved, and the toast says why. */
export function arrangeGroupAction(viewId: string | null, groupId: string): void {
    if (viewId === null) {
        return;
    }
    perform('group.arrange', { viewId, groupId }).catch((error: unknown) => {
        useToasts.getState().show({ kind: 'error', title: i18next.t('canvas:group.arrange'), description: messageOf(error) });
    });
}

export function historyAction(step: 'undo' | 'redo', viewId: string | null = activeViewId()): void {
    if (viewId === null) {
        return;
    }
    void perform(step === 'undo' ? 'history.undo' : 'history.redo', { viewId }).catch(ignoreRefusal);
}

/* The layout dialog and the dock's delete corner are the person's answer; neither asks about replacing or losing one. */
export function saveLayoutAction(name: string): void {
    const viewId = activeViewId();
    if (viewId !== null) {
        void perform('layout.save', { viewId, name }, { confirmed: true }).catch(ignoreRefusal);
    }
}

export function applyLayoutAction(name: string): void {
    const viewId = activeViewId();
    if (viewId !== null) {
        void perform('layout.apply', { viewId, name }).catch(ignoreRefusal);
    }
}

export function deleteLayoutAction(name: string): void {
    const viewId = activeViewId();
    if (viewId !== null) {
        void perform('layout.delete', { viewId, name }, { confirmed: true }).catch(ignoreRefusal);
    }
}

/* Null sets every gesture at once. */
export function setLocksAction(locked: boolean, gestures: (keyof Locks)[] | null = null): void {
    const viewId = activeViewId();
    if (viewId !== null) {
        void perform('canvas.setLocks', { viewId, locked, gestures }).catch(ignoreRefusal);
    }
}

export function splitAction(direction: 'right' | 'down'): void {
    void perform('split.create', { direction, viewId: null }).catch(ignoreRefusal);
}

/* Null closes the focused cell. */
export function closeCellAction(viewId: string | null = null): void {
    void perform('split.close', { viewId }).catch(ignoreRefusal);
}

/* Every cell but the one at `at`, through the questions of their loose tabs. */
export function closeOtherCellsAction(at: CellAt): void {
    void closeOtherCellsGuarded(at);
}

export function closeCellsRightOfAction(at: CellAt): void {
    void closeCellsRightOfGuarded(at);
}

/*
 * A tab of a host goes. A loose view closes for good, with the guards a file with unsaved changes and a
 * table with unsubmitted edits have. A view of the project only leaves the screen, its session and its
 * place in the list stay, but a database view with unsubmitted edits asks first as well.
 */
export function closeTabAction(viewId: string): void {
    void closeTabGuarded(viewId);
}

/* The other tabs of the host, the ones to the right of it or all of them; a pinned tab stays. */
export function closeTabsAction(viewId: string, closing: TabsClosing): void {
    void closeTabsAround(viewId, closing);
}

export function focusCellAction(direction: SplitDirection): void {
    void perform('split.focus', { direction }).catch(ignoreRefusal);
}

/* A drop on a cell: `cellViewId` is the view standing in the cell it landed on. */
export function placeViewAction(viewId: string, cellViewId: string, zone: SplitZone): void {
    void perform('split.placeView', { viewId, paths: null, cellViewId, zone }).catch(ignoreRefusal);
}

export function placeFilesAction(paths: readonly string[], cellViewId: string, zone: SplitZone, tabGap?: number | null): void {
    if (paths.length > 0) {
        void perform('split.placeView', { viewId: null, paths: [...paths], cellViewId, zone, ...(tabGap === undefined ? {} : { tabGap }) }).catch(
            ignoreRefusal
        );
    }
}

/*
 * Everything on the canvas, text included. Like a delete, a store that is not the canvas's own editor
 * (a canvas shown inside another view) selects in place.
 */
export function selectAllAction(store: StoreApi<CanvasState>): void {
    const canvas = store.getState();
    const ids = [...canvas.order, ...Object.keys(canvas.texts), ...Object.keys(canvas.lines)];
    if (canvas.viewId !== null && defaultCanvases.peek(canvas.viewId) === store && ids.length > 0) {
        void perform('canvas.select', { viewId: canvas.viewId, nodeIds: ids }).catch(ignoreRefusal);
        return;
    }
    canvas.select(ids);
}

/* The switch screen says how an open goes, so a refusal here stays quiet like every other person's action. */
export function openProjectAction(endpointId: string, projectId: string): void {
    void perform('project.switch', { endpointId, projectId }).catch(ignoreRefusal);
}

/* A click on a project row. Cmd-click (Ctrl-click off macOS) opens it in a window of its own. */
export function openProjectClickAction(event: { metaKey: boolean; ctrlKey: boolean }, endpointId: string, projectId: string): void {
    if (wantsNewWindow(event)) {
        openInNewWindow(endpointId, projectId);
        return;
    }
    openProjectAction(endpointId, projectId);
}

export function openFolderAction(endpointId: string, folder: string, createFolder: boolean): void {
    void perform('project.create', { endpointId, folder, createFolder }).catch(ignoreRefusal);
}

/* The cancel button of a git run: the run is named by the id its progress streams under. */
export function cancelGitRunAction(runId: string): void {
    void perform('operation.cancel', { operationId: `${GIT_OPERATION}${runId}` }).catch(ignoreRefusal);
}

/* Null takes the mark away. */
export function setViewIconAction(viewId: string, icon: ProjectIconChoice | null): void {
    void perform('view.setIcon', { viewId, icon: icon?.value ?? null }).catch(ignoreRefusal);
}

/* A color a person picks is the one the shortcut sets next; null takes the flags off. */
export function flagAction(ids: readonly string[], color: NodeAccent | null): void {
    if (color !== null) {
        rememberFlagColor(color);
    }
    void perform('flag.set', { ids: [...ids], color }).catch(ignoreRefusal);
}

/*
 * What the shortcut flags: the nodes selected on the canvas with the focus, else the view in the
 * focused cell. Flagged all over it takes the flags off; otherwise it flags the lot in the last color.
 */
export function toggleFlagAction(): void {
    const state = useDocument.getState();
    const view = activeViewOf(state);
    if (view === null) {
        return;
    }
    const selection = isCanvasView(view) ? focusedCanvas().getState().selection : [];
    const ids = selection.length > 0 ? selection : [view.id];
    const flagged = ids.every((id) => flagOf(state.flags, id) !== null);
    void perform('flag.set', { ids, color: flagged ? null : lastFlagColor() }).catch(ignoreRefusal);
}

/* A person's key or menu row is the answer, as a terminal's own Cmd+K always was. */
export function clearTerminalAction(terminalId: string): void {
    void perform('terminal.clear', { terminalId }, { confirmed: true }).catch(ignoreRefusal);
}

/* The body rebuilds its terminal once the fresh session is asked for; the action only asks. */
export function restartTerminalAction(terminalId: string): void {
    void perform('terminal.restart', { terminalId }).catch(ignoreRefusal);
}

export function resumeTerminalAgentAction(terminalId: string): void {
    void perform('terminal.resumeAgent', { terminalId }).catch(ignoreRefusal);
}
