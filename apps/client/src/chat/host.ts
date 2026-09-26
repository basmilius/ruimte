import i18next from 'i18next';
import { setChatHost, type ChatActions } from '@ruimte/agents-react/host';
import { setLazyPrefetch } from '@ruimte/agents-react/lazy';
import { performAsPerson, PERSON_PROMPT_CLIENTS } from '@/actions/client-actions';
import { askBeforeStoppingSubagents, askBeforeStoppingTask } from '@/agents/end-children';
import { FEATURED_ACCENTS, NODE_ACCENTS, accentLabel, type AccentId } from '@/canvas/accents';
import { searchFiles } from '@/chat/file-search';
import { isApplePlatform } from '@/desktop/bridge';
import { CODE_THEMES } from '@/shell/panels/code-themes';
import { useServers } from '@/state/server';
import { useSettings } from '@/state/settings';
import { useTasks } from '@/state/tasks';
import { useTheme } from '@/state/theme';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { transportFor } from '@/transport';
import { readResource } from '@/transport/byte-transfer';
import { useMachineUrl } from '@/transport/machine-url';
import { prefetcher } from '@/ui/prefetch';

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

/*
 * What the chat takes from Ruimte that the start screen may already need, handed over once before the
 * first render. What only a workspace draws is handed over by the workspace (`workspace-host.ts`), so
 * none of it reaches the first chunk.
 */
export const connectChatHost = (): void => {
    setLazyPrefetch((load) => prefetcher.register(load));
    setChatHost({
        accents: { all: NODE_ACCENTS, featured: FEATURED_ACCENTS, label: (id) => accentLabel(id as AccentId) },
        isApplePlatform,
        notify: (toast) => void useToasts.getState().show(toast),
        actions: PERSON_CHAT_ACTIONS,
        searchFiles,
        attachments: {
            useUrl: (endpointId, chatId, attachmentId) => useMachineUrl({ kind: 'attachment', chatId, attachmentId }, endpointId),
            read: async (endpointId, chatId, attachmentId) => {
                const transport = transportFor(endpointId);
                if (transport === null) {
                    throw new Error(i18next.t('agent-chat:composer.placeholder.disconnected'));
                }
                return readResource((piece) => transport.request('bytes.read', piece), { kind: 'attachment', chatId, attachmentId });
            }
        },
        code: {
            useMode: () => useTheme((s) => s.resolved),
            useThemes: () => ({ light: useSettings((s) => s.codeThemeLight), dark: useSettings((s) => s.codeThemeDark) }),
            custom: CODE_THEMES
        },
        useStreaming: () => useSettings((s) => s.chatStreaming),
        tasks: {
            useTasks: (endpointId) => useTasks((s) => s.byEndpoint[endpointId]),
            useTask: (endpointId, taskId) => useTasks((s) => (taskId === null ? null : (s.byEndpoint[endpointId]?.[taskId] ?? null)))
        },
        confirm: {
            stopSubagents: (endpointId, chatId, run) => void askBeforeStoppingSubagents(transportFor(endpointId), chatId, run),
            stopTask: (endpointId, childId, title, run) => void askBeforeStoppingTask(transportFor(endpointId), childId, title, run)
        },
        fork: (chatId, turnId) => useUi.getState().setForkDialog({ chatId, turnId }),
        openSettings: (section) => useUi.getState().setSettings({ open: true, section }),
        useResumeAtReset: (endpointId) => useServers((s) => s.byEndpoint[endpointId]?.resumeAtReset === true)
    });
};
