import i18next from 'i18next';
import { defineBehaviors } from '@/commands/behavior';
import { newWorktreeChatDialog } from '@/worktrees/dialogs';

export const WORKTREE_BEHAVIORS = defineBehaviors({
    'chat-new-worktree': {
        run: () => newWorktreeChatDialog.set(true),
        offered: (moment) => moment.folder !== null && !moment.scratch && { hint: i18next.t('shell:chats.name') }
    }
});
