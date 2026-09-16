import { ContextMenu } from '@base-ui-components/react/context-menu';
import { GitFork } from 'lucide-react';
import { forkRefusal, lastSettledTurn } from '@/chat/logic/fork';
import { useChatRow } from '@/state/chats';
import { useUi } from '@/state/ui';
import { MENU_HINT } from '@/ui/classes';
import { Icon } from '@/ui/Icon';

/* "Fork conversation..." in the menu of a chat node or a chat view: a fork after the last turn that ended. */
export function ForkMenuItem({ chatId }: { chatId: string }) {
    const turnId = useChatRow(chatId, (row) => (row ? lastSettledTurn(row.structure, row.order) : null));
    const refusal = useChatRow(chatId, (row) => (turnId === null ? null : forkRefusal(row?.info ?? null, row?.structure[turnId])));
    if (turnId === null) {
        return null;
    }
    return (
        <ContextMenu.Item className="menu-item" disabled={refusal !== null} onClick={() => useUi.getState().setForkDialog({ chatId, turnId })}>
            <Icon icon={GitFork} size={14} /> Fork conversation...
            {refusal !== null && <span className={MENU_HINT}>{refusal}</span>}
        </ContextMenu.Item>
    );
}
