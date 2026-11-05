import type { ChatSendExtras } from '@adecore/agents-react/chat';
import { recentChatMessages } from '@adecore/agents-react/chat';
import { useChats, providersOf } from '@adecore/agents-react/state';
import { ActionRefusal, ActionRegistry, type ActionCall, type ActionHandlers } from '@ruimte/actions';
import type { ChatItem, ProviderInfo } from '@ruimte/contracts';
import type { StoreApi } from 'zustand';
import { provideClientActions } from '@/action-port/perform';
import { canvasActions } from '@/actions/canvas-actions';
import { chatSearchActions, type ChatSearchMachine } from '@/actions/chat-search-actions';
import { contentActions, type ContentMachine } from '@/actions/content-actions';
import { databaseActions, type DatabaseMachine } from '@/actions/database-actions';
import { asksFirst, developerActions, type DeveloperMachine } from '@/actions/developer-actions';
import { extensionVoiceActions } from '@/actions/extension-actions';
import { filesActions, type FilesMachine } from '@/actions/files-actions';
import { inspectionActions } from '@/actions/inspection-actions';
import { launchActions, type LaunchReach } from '@/actions/launch-actions';
import { layoutActions } from '@/actions/layout-actions';
import { machineActions, type MachineReach } from '@/actions/machine-actions';
import { chatClientOfNode, sessionClientOfNode } from '@/actions/node-machine';
import { pageActions, type PageMachine } from '@/actions/page-actions';
import { projectActions, type ProjectMachine } from '@/actions/project-actions';
import { refusing } from '@/actions/refusal';
import { resolveTarget } from '@/actions/resolve-target';
import { checkClientRevision } from '@/actions/revision';
import { sessionActions, sessionTitle, type SessionMachine } from '@/actions/session-actions';
import { terminalPrepareActions } from '@/actions/terminal-prepare-actions';
import { viewActions } from '@/actions/view-actions';
import { designFoldersOnDisk } from '@/design/design-read';
import { liveViewDeletion, type ViewDeletionMachine } from '@/project/view-deletion';
import { currentEndpointId } from '@/state/current-endpoint';
import { useDocument, type DocumentState } from '@/state/document';
import { endpointKey } from '@/state/keys';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { shownFolderOf, useProject } from '@/state/project';
import { diagramClient, drawingClient } from '@/workspace/connections';

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
    sendChat: (chatId, text, extras) => chatClientOfNode(chatId).send(chatId, text, extras),
    clearChat: (chatId, force) => chatClientOfNode(chatId).clear(chatId, force),
    inspectChat: (chatId) => chatClientOfNode(chatId).inspect(chatId),
    clearTerminal: (terminalId) => sessionClientOfNode(terminalId).clear(terminalId),
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
        ...extensionVoiceActions(),
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
provideClientActions(clientActions);

export const VOICE_ACTION_CALL: ActionCall<void> = {
    actor: { kind: 'voice', id: 'voice-session' },
    context: undefined
};
