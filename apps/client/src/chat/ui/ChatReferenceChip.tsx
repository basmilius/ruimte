import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { MessageSquare, X } from 'lucide-react';
import { CHIP_IN_MESSAGE, MENTION_TONE } from '@/chat/ui/chips';
import { useProjectChats } from '@/chat/ui/use-project-chats';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* A chat attached to a message, under the title it has now rather than the one it had when it was attached. */
export function ChatReferenceChip({ chatId, onRemove }: { chatId: string; onRemove?: () => void }) {
    const { t } = useTranslation('chat');
    const chat = useProjectChats().find((candidate) => candidate.id === chatId);
    const title = chat === undefined ? t('chatReference.gone') : chat.title || t('chatReference.untitled');
    return (
        <span className={clsx(MENTION_TONE, CHIP_IN_MESSAGE)}>
            <Icon icon={MessageSquare} size={12} className="shrink-0" />
            <span className="truncate">{title}</span>
            {onRemove && (
                <Tooltip label={t('chatReference.remove', { title })} name>
                    <button className="-mr-0.5 shrink-0 rounded-sm opacity-70 hover:opacity-100" onClick={onRemove}>
                        <Icon icon={X} size={12} />
                    </button>
                </Tooltip>
            )}
        </span>
    );
}
