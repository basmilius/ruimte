import { messageOf } from '@adecore/ui';
import i18next from 'i18next';
import { perform } from '@/actions/client-actions';
import { useToasts } from '@/state/toasts';

/* Ends the chat's CLI and keeps its conversation, and says how that went. */
export async function restartChatSession(chatId: string): Promise<void> {
    try {
        await perform('chat.restart', { chatId });
        useToasts.getState().show({ kind: 'success', title: i18next.t('chat:restart.done'), description: i18next.t('chat:restart.doneDescription') });
    } catch (e) {
        useToasts.getState().show({ kind: 'error', title: i18next.t('chat:restart.failed'), description: messageOf(e) });
    }
}
