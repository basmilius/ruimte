import { forkRefusal, lastSettledTurn, summaryRefusal } from '@adecore/agents-react/chat';
import { useChatRow } from '@adecore/agents-react/state';
import { DisabledReason, Icon, ContextMenu, messageOf } from '@adecore/ui';
import { GitFork, MessageSquareShare, Undo2 } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { perform } from '@/action-port/perform';
import { openForkDialog } from '@/chat/open-fork';
import { useChatPlace } from '@/project/use-chat-place';
import { useToasts } from '@/state/toasts';

/*
 * Forks after the last turn that ended. A chat that is a fork adds the way back: a summary for its
 * original, and the original itself.
 */
export function ForkMenuItem({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const turnId = useChatRow(chatId, (row) => (row ? lastSettledTurn(row.structure, row.order) : null));
    const refusal = useChatRow(chatId, (row) => (turnId === null ? null : forkRefusal(row?.info ?? null, row?.structure[turnId])));
    const forked = useChatRow(chatId, (row) => row?.info.forkOf !== undefined);
    return (
        <>
            {turnId !== null && (
                <DisabledReason reason={refusal}>
                    <ContextMenu.Item disabled={refusal !== null} onClick={() => openForkDialog(chatId, turnId)}>
                        <Icon icon={GitFork} size={14} /> {t('fork.menu.fork')}
                    </ContextMenu.Item>
                </DisabledReason>
            )}
            {forked && <ForkBackItems chatId={chatId} />}
        </>
    );
}

function ForkBackItems({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const originalId = useChatRow(chatId, (row) => row?.info.forkOf?.chatId ?? '');
    const busy = useChatRow(chatId, (row) => row?.info.activeTurnId !== null && row?.info.activeTurnId !== undefined);
    const original = useChatPlace(originalId);
    const refusal = summaryRefusal({ busy, originalPresent: original.title !== null });
    const summarize = (): void => {
        perform('chat.summarize', { chatId }).catch((e: unknown) => {
            useToasts.getState().show({ title: t('fork.menu.summaryFailed'), description: messageOf(e), kind: 'error' });
        });
    };
    return (
        <>
            <DisabledReason reason={refusal}>
                <ContextMenu.Item disabled={refusal !== null} onClick={summarize}>
                    <Icon icon={MessageSquareShare} size={14} />{' '}
                    {original.title === null ? t('fork.menu.summarize') : t('fork.menu.summarizeFor', { title: original.title })}
                </ContextMenu.Item>
            </DisabledReason>
            <DisabledReason reason={original.title === null ? t('fork.refusal.originalGone') : null}>
                <ContextMenu.Item disabled={original.title === null} onClick={original.go}>
                    <Icon icon={Undo2} size={14} /> {t('fork.menu.showOriginal')}
                </ContextMenu.Item>
            </DisabledReason>
        </>
    );
}
