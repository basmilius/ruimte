import i18next from 'i18next';
import { defineBehaviors } from '@/commands/behavior';
import { useUi } from '@/state/ui';

export const WORKTREE_BEHAVIORS = defineBehaviors({
    'chat-new-worktree': {
        run: () => useUi.getState().setNewWorktreeChatOpen(true),
        offered: (moment) => moment.folder !== null && !moment.scratch && { hint: i18next.t('shell:chats.name') }
    }
});
