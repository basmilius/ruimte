import { createElement } from 'react';
import { siClaude } from 'simple-icons';
import i18next from 'i18next';
import { codeHighlighter } from '@/code-highlighter';
import DiffSyntaxWorker from '@/chat/diff-syntax.worker?worker';
import { type AgentMark, configureAgentMarks, configureChatStorage, type ChatActions, type ChatHost, setLazyPrefetch } from '@adecore/agents-react';
import { useChats } from '@adecore/agents-react/state';
import { perform, PERSON_PROMPT_CLIENTS } from '@/actions/client-actions';
import { askBeforeStoppingSubagents, askBeforeStoppingTask } from '@/agents/end-children';
import { FEATURED_ACCENTS, NODE_ACCENTS, accentLabel, type AccentId } from '@/canvas/accents';
import { searchFiles } from '@/chat/file-search';
import { RUIMTE_COMMAND_LOOKS } from '@/chat/ruimte-command-look';
import { openLogin } from '@/chat/login';
import { openForkDialog } from '@/chat/open-fork';
import { useMachinePlatform } from '@/chat/machine-platform';
import { gitStatusConcernsChat } from '@/chat/ui-refresh';
import { readToolOutput } from '@/chat/tool-output';
import { useMapSource } from '@/chat/use-map-source';
import { visualHostFor } from '@/chat/visuals';
import { desktop, isApplePlatform } from '@/desktop/bridge';
import { downloadBlob } from '@/download';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { CODE_THEMES } from '@/shell/panels/code-themes';
import { useEndpoints } from '@/state/endpoints';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { useDocument } from '@/state/document';
import { isScratchProject, useProject } from '@/state/project';
import { useProjectList } from '@/state/project-list';
import { useServers } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useTasks } from '@/state/tasks';
import { useTheme } from '@/state/theme';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { transportFor, type Transport } from '@/transport';
import { readResource } from '@/transport/byte-transfer';
import { readPiece } from '@/transport/piece';
import { useMachineAnswers } from '@/transport/features';
import { useMachineUrl } from '@/transport/machine-url';
import { RuimteMark } from '@/ui/RuimteMark';
import { prefetcher, messageOf } from '@adecore/ui';
import { type AgentKind, CHAT_MODEL_MAX_BYTES } from '@ruimte/contracts';

/* Every action goes through the registry as the person who clicked, the same door Voice uses. */
const PERSON_CHAT_ACTIONS: ChatActions = {
    ...PERSON_PROMPT_CLIENTS,
    clear: async (chatId, force) => {
        await perform('chat.clear', { chatId, force });
    },
    stopTurn: async (chatId, subagents) => {
        await perform('chat.stopTurn', { chatId, subagents });
    },
    unqueue: async (chatId, messageId) => {
        await perform('chat.unqueue', { chatId, messageId });
    },
    sendNow: async (chatId, messageId) => {
        await perform('chat.sendNow', { chatId, messageId });
    },
    compact: async (chatId) => {
        await perform('chat.compact', { chatId });
    },
    configure: async (chatId, patch) => {
        await perform('chat.configure', { chatId, model: null, option: null, ...patch });
    },
    continueOn: async (chatId, account) => {
        await perform('chat.continueOn', { chatId, account });
    },
    turnDiff: async (chatId, turnId) => (await perform('chat.turnDiff', { chatId, turnId })).diff,
    // Only the thread reads this, so it asks the chat's machine directly rather than through the registry.
    toolOutput: (chatId, itemId) => readToolOutput(transportFor(endpointOfNodeId(chatId)), chatId, itemId),
    stopSubagent: async (chatId, toolUseId) => {
        await perform('chat.stopSubagent', { chatId, toolUseId });
    },
    stopTask: async (chatId, taskId) => {
        await perform('chat.stopTask', { chatId, taskId });
    },
    goal: async (chatId, action) => {
        await perform('chat.goal', { chatId, change: action });
    }
};

function requireTransport(endpointId: string): Transport {
    const transport = transportFor(endpointId);
    if (transport === null) {
        throw new Error(i18next.t('chat:offline'));
    }
    return transport;
}

/*
 * The marks of the providers the shared `AgentIcon` has none for. The Claude API wears Claude's. Grok's is the xAI logo. Antigravity's is the one
 * Google lists in the ACP registry (agentclientprotocol/registry, `antigravity-acp/icon.svg`).
 */
const AGENT_MARKS: Partial<Record<AgentKind, AgentMark>> = {
    'anthropic-claude-api': { title: 'Claude API', path: siClaude.path },
    antigravity: {
        title: 'Antigravity',
        viewBox: '0 0 16 16',
        path: 'M14.1452 14.6818C14.9937 15.3182 16.2664 14.894 15.0997 13.7273C11.5998 10.3333 12.3421 1 7.99366 1C3.64518 1 4.3876 10.3333 0.887603 13.7273C-0.385123 15 0.993664 15.3182 1.84215 14.6818C5.13002 12.4545 4.9179 8.5303 7.99366 8.5303C11.0694 8.5303 10.8573 12.4545 14.1452 14.6818Z'
    },
    grok: {
        title: 'Grok',
        path: 'M6.469 8.776 16.512 23h-4.464L2.005 8.776H6.47Zm-.004 7.9 2.233 3.164L6.467 23H2l4.465-6.324ZM22 2.582V23h-3.659V7.764L22 2.582ZM22 1l-9.952 14.095-2.233-3.163L17.533 1H22Z'
    }
};

/* The stores every chat view shares, set up before the first render. */
export function configureChat(): void {
    configureChatStorage({ namespace: 'ruimte' });
    configureAgentMarks(AGENT_MARKS);
    setLazyPrefetch((load) => prefetcher.register(load));
}

/*
 * What the chat takes from Ruimte that the start screen may already need. What only a workspace draws
 * is in `workspace-host.ts`, so none of it reaches the first chunk.
 */
export const CHAT_HOST: Partial<ChatHost> = {
    accents: {
        all: NODE_ACCENTS,
        featured: FEATURED_ACCENTS,
        label: (id) => accentLabel(id as AccentId),
        current: () => useSettings.getState().accent
    },
    isApplePlatform,
    // Named here, in the app's own source, so Vite serves the worker while it pre-bundles the chat package.
    maps: { useSource: useMapSource, workerUrl: new URL('maplibre-gl/dist/maplibre-gl-worker.mjs', import.meta.url).href },
    notify: (toast) => void useToasts.getState().show(toast),
    actions: PERSON_CHAT_ACTIONS,
    intelligentUi: {
        link: async (endpointId, payload) => requireTransport(endpointId).request('ui.link', payload),
        subscribe: (endpointId, chatId, changed) => {
            const transport = transportFor(endpointId);
            if (transport === null) {
                return () => {};
            }
            const project = (): { projectId: string; folder: string } | null => (endpointId === currentEndpointId() ? useProject.getState().current : null);
            const off = [
                transport.on('git.status', ({ cwd }) => {
                    const chatCwd = useChats.getState().statusByKey[endpointKey(endpointId, chatId)]?.info.cwd ?? null;
                    if (gitStatusConcernsChat(cwd, project(), chatCwd)) {
                        changed();
                    }
                }),
                transport.on('launch.status', (status) => {
                    const current = project();
                    if (current === null || status.projectId === current.projectId) {
                        changed();
                    }
                }),
                transport.on('task.changed', ({ task }) => {
                    if (task.parentId === chatId) {
                        changed();
                    }
                })
            ];
            return () => {
                for (const stop of off) {
                    stop();
                }
            };
        },
        query: async (endpointId, payload) => requireTransport(endpointId).request('ui.query', payload),
        sendChoice: async (endpointId, payload) => {
            if (endpointId !== currentEndpointId()) {
                throw new Error(i18next.t('chat:offline'));
            }
            const result = await perform('chat.uiChoice', payload);
            return result.queued ? 'queued' : 'sent';
        }
    },
    searchFiles,
    attachments: {
        useUrl: (endpointId, chatId, attachmentId) => useMachineUrl({ kind: 'attachment', chatId, attachmentId }, endpointId),
        read: async (endpointId, chatId, attachmentId) => {
            const transport = requireTransport(endpointId);
            return readResource((piece) => readPiece(transport, piece), { kind: 'attachment', chatId, attachmentId }, { maxBytes: CHAT_MODEL_MAX_BYTES });
        },
        open: (endpointId, chatId, attachmentId, suggestedName) => {
            void (async () => {
                const transport = requireTransport(endpointId);
                const image = await readResource((piece) => readPiece(transport, piece), { kind: 'attachment', chatId, attachmentId });
                const bridge = desktop();
                if (bridge?.openImage) {
                    await bridge.openImage(suggestedName, new Uint8Array(await image.arrayBuffer()), image.type);
                } else {
                    downloadBlob(image, suggestedName);
                }
            })().catch((error: unknown) =>
                useToasts.getState().show({
                    kind: 'error',
                    title: i18next.t('chat:generatedImage.openFailed'),
                    description: messageOf(error)
                })
            );
        },
        saveToProject: async (endpointId, chatId, attachmentId) => {
            try {
                const transport = requireTransport(endpointId);
                // The dialog and its folder tree belong to a workspace, so the start screen loads none of it.
                const { requestImageSave } = await import('@/chat/image-save');
                return await requestImageSave(transport, chatId, attachmentId);
            } catch (error) {
                useToasts.getState().show({
                    kind: 'error',
                    title: i18next.t('chat:generatedImage.saveFailed'),
                    description: messageOf(error)
                });
                return null;
            }
        }
    },
    visuals: visualHostFor(window.location.origin, desktop, (url) => void window.open(url, '_blank', 'noopener,noreferrer')),
    code: {
        useMode: () => useTheme((s) => s.resolved),
        useThemes: () => ({ light: useSettings((s) => s.codeThemeLight), dark: useSettings((s) => s.codeThemeDark) }),
        custom: CODE_THEMES,
        highlighter: codeHighlighter,
        syntaxWorker: () => new DiffSyntaxWorker(),
        editor: async () => {
            const { loadEditorEngine } = await import('@/shell/panels/editor-engine');
            return loadEditorEngine();
        }
    },
    useStreaming: () => useSettings((s) => s.chatStreaming),
    useSendDelivery: () => useSettings((s) => (s.chatSteerByDefault ? 'steer' : 'queue')),
    useHidesToolCalls: () => useSettings((s) => s.chatHideToolCalls),
    tasks: {
        useTasks: (endpointId) => useTasks((s) => s.byEndpoint[endpointId]),
        useTask: (endpointId, taskId) => useTasks((s) => (taskId === null ? null : (s.byEndpoint[endpointId]?.[taskId] ?? null)))
    },
    confirm: {
        stopSubagents: (endpointId, chatId, run) => void askBeforeStoppingSubagents(transportFor(endpointId), chatId, run),
        stopTask: (endpointId, childId, title, run) => void askBeforeStoppingTask(transportFor(endpointId), childId, title, run)
    },
    openLogin,
    useProjectLook: (endpointId, projectId) => {
        const summary = useProjectList(
            (s) => s.projects.find((row) => row.endpointId === endpointId && projectId !== null && row.summary.projectId === projectId)?.summary
        );
        return summary === undefined
            ? null
            : {
                  name: summary.name,
                  mark: createElement(ProjectGlyph, {
                      projectId: summary.projectId,
                      endpointId,
                      icon: summary.icon,
                      color: summary.color,
                      size: 16,
                      scratch: summary.scratch === true
                  })
              };
    },
    fork: openForkDialog,
    openSettings: (section) => useUi.getState().setSettings({ open: true, section }),
    useMachineLabel: (endpointId) => useEndpoints((s) => s.endpoints.find((endpoint) => endpoint.id === endpointId)?.label ?? null),
    // A shell of its own over the settings, so it works with no project open; the command waits for the person's Enter.
    runProviderCommand: (endpointId, kind, command) => useUi.getState().setProviderCommand({ endpointId, kind, command }),
    useMachinePlatform,
    providerKeyNote: () => i18next.t('settings:providers.keyNote'),
    useResumeAtReset: (endpointId) => useServers((s) => s.byEndpoint[endpointId]?.resumeAtReset === true),
    useCanReorderAccounts: (endpointId) => useMachineAnswers(endpointId, 'accounts.reorder'),
    // A chat on screen belongs to the project the window shows; an account id only means something on that project's machine.
    useAccountRule: (endpointId) => {
        const accounts = useDocument((s) => s.accounts);
        return endpointId === currentEndpointId() ? accounts : null;
    },
    // A chat on screen belongs to the project the window shows, and the Chats project shows none of its folders.
    useHidesFolder: () => useProject((s) => isScratchProject(s.current)),
    // A chat of the Chats project is a conversation of its own, so it opens the way one does.
    useWelcome: () => useProject((s) => isScratchProject(s.current)),
    commandLooks: RUIMTE_COMMAND_LOOKS,
    saidBy: { name: 'Ruimte', mark: createElement(RuimteMark, { size: 14 }) }
};
