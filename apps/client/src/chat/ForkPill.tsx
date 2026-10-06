import { useTranslation } from 'react-i18next';
import { GitFork } from 'lucide-react';
import { forkPointOf } from '@adecore/agents-react/chat/logic/fork';
import { formatDayClock } from '@adecore/ui/format';
import { Icon, Pill, Tooltip } from '@adecore/ui';
import { useChatPlace } from '@/chat/use-chat-place';
import { useChatRow } from '@adecore/agents-react/state/chats';

/*
 * Where a forked chat came from, in its node's header or its view's toolbar. Pressing it leads back
 * to the original: the camera to a node on this canvas, over to the canvas of a node elsewhere, or
 * the original's own view.
 */
export function ForkPill({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const forkOf = useChatRow(chatId, (row) => row?.info.forkOf);
    const turn = useChatRow(chatId, (row) => {
        const point = row && forkOf ? forkPointOf(row.structure, row.order, forkOf.turnId, row.history === undefined) : null;
        return point?.counted ? point.number : null;
    });
    const original = useChatPlace(forkOf?.chatId ?? '');
    if (!forkOf) {
        return null;
    }
    const at = formatDayClock(forkOf.at);
    const when = turn === null ? t('fork.pill.when', { at }) : t('fork.pill.whenTurn', { at, turn });
    const icon = <Icon icon={GitFork} size={12} />;
    if (original.title === null) {
        return (
            <Tooltip label={t('fork.pill.orphaned', { when })}>
                <Pill icon={icon}>{t('fork.pill.label')}</Pill>
            </Tooltip>
        );
    }
    return (
        <Tooltip label={when}>
            <Pill icon={icon} className="max-w-48" onClick={original.go}>
                <span className="truncate">{t('fork.pill.of', { title: original.title })}</span>
            </Pill>
        </Tooltip>
    );
}
