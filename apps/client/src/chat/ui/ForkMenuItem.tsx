import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { GitFork, MessageSquareShare, Undo2 } from 'lucide-react';
import { performAsPerson } from '@/actions/client-actions';
import { forkRefusal, lastSettledTurn, summaryRefusal } from '@/chat/logic/fork';
import { useChatPlace } from '@/chat/ui/use-chat-place';
import { useChatRow } from '@/state/chats';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { DisabledReason } from '@/ui/DisabledReason';
import { Icon } from '@/ui/Icon';

/*
 * Whether `ForkMenuItem` draws anything at all. A menu that puts a line above the row has to know
 * that before it draws the line, or a chat nobody has written in yet gets two lines against each
 * other. It asks the same two questions the component asks, so the two move together.
 */
export const useOffersFork = (chatId: string): boolean => {
    const settled = useChatRow(chatId, (row) => (row ? lastSettledTurn(row.structure, row.order) !== null : false));
    const forked = useChatRow(chatId, (row) => row?.info.forkOf !== undefined);
    return settled || forked;
};

/*
 * "Fork conversation..." in the menu of a chat node or a chat view, offered as a fork after the last
 * turn that ended. A chat that is a fork adds the way back: asking it for a summary for its original, and the
 * original itself.
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
                    <ContextMenu.Item className="menu-item" disabled={refusal !== null} onClick={() => useUi.getState().setForkDialog({ chatId, turnId })}>
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
        performAsPerson('chat.summarize', { chatId }).catch((e: unknown) => {
            useToasts.getState().show({ title: t('fork.menu.summaryFailed'), description: e instanceof Error ? e.message : String(e), kind: 'error' });
        });
    };
    return (
        <>
            <DisabledReason reason={refusal}>
                <ContextMenu.Item className="menu-item" disabled={refusal !== null} onClick={summarize}>
                    <Icon icon={MessageSquareShare} size={14} />{' '}
                    {original.title === null ? t('fork.menu.summarize') : t('fork.menu.summarizeFor', { title: original.title })}
                </ContextMenu.Item>
            </DisabledReason>
            <DisabledReason reason={original.title === null ? t('fork.refusal.originalGone') : null}>
                <ContextMenu.Item className="menu-item" disabled={original.title === null} onClick={original.go}>
                    <Icon icon={Undo2} size={14} /> {t('fork.menu.showOriginal')}
                </ContextMenu.Item>
            </DisabledReason>
        </>
    );
}
