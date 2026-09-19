import { useTranslation } from 'react-i18next';
import { ContextMenu } from '@base-ui-components/react/context-menu';
import { GitFork, MessageSquareShare, Undo2 } from 'lucide-react';
import { forkRefusal, lastSettledTurn, summaryRefusal } from '@/chat/logic/fork';
import { useChatPlace } from '@/chat/ui/use-chat-place';
import { useChatRow } from '@/state/chats';
import { useToasts } from '@/state/toasts';
import { useUi } from '@/state/ui';
import { useTransport } from '@/transport/context';
import { MENU_HINT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

/*
 * "Fork conversation..." in the menu of a chat node or a chat view: a fork after the last turn that
 * ended. A chat that is a fork adds the way back: asking it for a summary for its original, and the
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
                <ContextMenu.Item className="menu-item" disabled={refusal !== null} onClick={() => useUi.getState().setForkDialog({ chatId, turnId })}>
                    <Icon icon={GitFork} size={14} /> {t('fork.menu.fork')}
                    {refusal !== null && <span className={MENU_HINT}>{refusal}</span>}
                </ContextMenu.Item>
            )}
            {forked && <ForkBackItems chatId={chatId} />}
        </>
    );
}

function ForkBackItems({ chatId }: { chatId: string }) {
    const { t } = useTranslation('chat');
    const transport = useTransport();
    const originalId = useChatRow(chatId, (row) => row?.info.forkOf?.chatId ?? '');
    const busy = useChatRow(chatId, (row) => row?.info.activeTurnId !== null && row?.info.activeTurnId !== undefined);
    const original = useChatPlace(originalId);
    const refusal = summaryRefusal({ busy, originalPresent: original.title !== null });
    const summarize = (): void => {
        transport.request('chat.summarize', { chatId }).catch((e: unknown) => {
            useToasts.getState().show({ title: t('fork.menu.summaryFailed'), description: e instanceof Error ? e.message : String(e), kind: 'error' });
        });
    };
    return (
        <>
            <ContextMenu.Item className="menu-item" disabled={refusal !== null} onClick={summarize}>
                <Icon icon={MessageSquareShare} size={14} />{' '}
                {original.title === null ? t('fork.menu.summarize') : t('fork.menu.summarizeFor', { title: original.title })}
                {refusal !== null && <span className={MENU_HINT}>{refusal}</span>}
            </ContextMenu.Item>
            <ContextMenu.Item className="menu-item" disabled={original.title === null} onClick={original.go}>
                <Icon icon={Undo2} size={14} /> {t('fork.menu.showOriginal')}
            </ContextMenu.Item>
        </>
    );
}
