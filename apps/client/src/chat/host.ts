import { createElement } from 'react';
import i18next from 'i18next';
import { configureChatStorage } from '@adecore/agents-react/storage';
import { setChatHost, type ChatActions } from '@adecore/agents-react/host';
import { setLazyPrefetch } from '@adecore/agents-react/lazy';
import { useChats } from '@adecore/agents-react/state/chats';
import { performAsPerson, PERSON_PROMPT_CLIENTS } from '@/actions/client-actions';
import { askBeforeStoppingSubagents, askBeforeStoppingTask } from '@/agents/end-children';
import { FEATURED_ACCENTS, NODE_ACCENTS, accentLabel, type AccentId } from '@/canvas/accents';
import { searchFiles } from '@/chat/file-search';
import { openLogin } from '@/chat/login';
import { gitStatusConcernsChat } from '@/chat/ui-refresh';
import { visualHostFor } from '@/chat/visuals';
import { desktop, isApplePlatform } from '@/desktop/bridge';
import { downloadBlob } from '@/download';
import { ProjectGlyph } from '@/project/ProjectGlyph';
import { CODE_THEMES } from '@/shell/panels/code-themes';
import { currentEndpointId, endpointKey } from '@/state/keys';
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
import { useMachineUrl } from '@/transport/machine-url';
import { prefetcher } from '@adecore/ui';

/* Every action goes through the registry as the person who clicked, the same door Voice uses. */
const PERSON_CHAT_ACTIONS: ChatActions = {
    ...PERSON_PROMPT_CLIENTS,
    clear: async (chatId, force) => {
        await performAsPerson('chat.clear', { chatId, force });
    },
    stopTurn: async (chatId, subagents) => {
        await performAsPerson('chat.stopTurn', { chatId, subagents });
    },
    unqueue: async (chatId, messageId) => {
        await performAsPerson('chat.unqueue', { chatId, messageId });
    },
    sendNow: async (chatId, messageId) => {
        await performAsPerson('chat.sendNow', { chatId, messageId });
    },
    compact: async (chatId) => {
        await performAsPerson('chat.compact', { chatId });
    },
    configure: async (chatId, patch) => {
        await performAsPerson('chat.configure', { chatId, model: null, option: null, ...patch });
    },
    continueOn: async (chatId, account) => {
        await performAsPerson('chat.continueOn', { chatId, account });
    },
    turnDiff: async (chatId, turnId) => (await performAsPerson('chat.turnDiff', { chatId, turnId })).diff,
    stopSubagent: async (chatId, toolUseId) => {
        await performAsPerson('chat.stopSubagent', { chatId, toolUseId });
    },
    stopTask: async (chatId, taskId) => {
        await performAsPerson('chat.stopTask', { chatId, taskId });
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
 * What the chat takes from Ruimte that the start screen may already need, handed over once before the
 * first render. What only a workspace draws is handed over by the workspace (`workspace-host.ts`), so
 * none of it reaches the first chunk.
 */
export function connectChatHost(): void {
    configureChatStorage({ namespace: 'ruimte' });
    setLazyPrefetch((load) => prefetcher.register(load));
    setChatHost({
        accents: {
            all: NODE_ACCENTS,
            featured: FEATURED_ACCENTS,
            label: (id) => accentLabel(id as AccentId),
            current: () => useSettings.getState().accent
        },
        isApplePlatform,
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
                const result = await performAsPerson('chat.uiChoice', payload);
                return result.queued ? 'queued' : 'sent';
            }
        },
        searchFiles,
        attachments: {
            useUrl: (endpointId, chatId, attachmentId) => useMachineUrl({ kind: 'attachment', chatId, attachmentId }, endpointId),
            read: async (endpointId, chatId, attachmentId) => {
                const transport = requireTransport(endpointId);
                return readResource((piece) => readPiece(transport, piece), { kind: 'attachment', chatId, attachmentId });
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
                        description: error instanceof Error ? error.message : String(error)
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
                        description: error instanceof Error ? error.message : String(error)
                    });
                    return null;
                }
            }
        },
        visuals: visualHostFor(window.location.origin, desktop, (url) => void window.open(url, '_blank', 'noopener,noreferrer')),
        code: {
            useMode: () => useTheme((s) => s.resolved),
            useThemes: () => ({ light: useSettings((s) => s.codeThemeLight), dark: useSettings((s) => s.codeThemeDark) }),
            custom: CODE_THEMES
        },
        useStreaming: () => useSettings((s) => s.chatStreaming),
        useSendDelivery: () => useSettings((s) => (s.chatSteerByDefault ? 'steer' : 'queue')),
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
        fork: (chatId, turnId) => useUi.getState().setForkDialog({ chatId, turnId }),
        openSettings: (section) => useUi.getState().setSettings({ open: true, section }),
        useResumeAtReset: (endpointId) => useServers((s) => s.byEndpoint[endpointId]?.resumeAtReset === true),
        // A chat on screen belongs to the project the window shows, and the Chats project shows none of its folders.
        useHidesFolder: () => useProject((s) => isScratchProject(s.current)),
        // A chat of the Chats project is a conversation of its own, so it opens the way one does.
        useWelcome: () => useProject((s) => isScratchProject(s.current))
    });
}
