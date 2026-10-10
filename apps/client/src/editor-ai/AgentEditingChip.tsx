import { useTranslation } from 'react-i18next';
import { Tooltip } from '@adecore/ui';
import { chooserChats } from '@/chat/chat-chooser';
import { focusChat } from '@/plan/plan-actions';
import { useSidebarSource } from '@/shell/sidebar-source';
import type { LiveWriter } from './agent-changes';
import { colorOfChat } from './agent-runs';
import { ChatMark } from './ChatMark';
import { useProviderName } from './use-chat-identity';

/* The toolbar's word that an agent is writing in this file: its mark in its color, who, and the chat it is, a press away. */
export function AgentEditingChip({ writer }: { writer: LiveWriter }) {
    const { t } = useTranslation('panels');
    const source = useSidebarSource();
    const chat = chooserChats(source).find((candidate) => candidate.id === writer.chatId);
    const provider = chat?.provider ?? null;
    const name = useProviderName(provider ?? undefined);

    return (
        <Tooltip label={t('file.agent.focusChat')}>
            <button
                type="button"
                className="flex h-6 min-w-0 items-center gap-1.5 rounded-md px-2 text-xs text-text hover:bg-surface-hover"
                onClick={() => focusChat(writer.chatId)}
            >
                <ChatMark provider={provider} color={colorOfChat(writer.chatId)} size={12} />
                <span className="truncate">{t('file.agent.editing', { name })}</span>
                {chat !== undefined && <span className="truncate text-text-muted">{chat.title}</span>}
            </button>
        </Tooltip>
    );
}
