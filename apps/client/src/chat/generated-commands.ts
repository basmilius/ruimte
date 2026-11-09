import { Folder } from 'lucide-react';
import { CHAT_MOVE_PREFIX } from '@/chat/menu-extras';
import type { GeneratedCommands } from '@/commands/generated';
import { moveChatDialog } from '@/project/dialogs';
import { activeViewFacts } from '@/views/active-view';

/* The menu's rows that move the chat in front to one project each, kept apart so the start screen's chunk holds no command of a workspace. */
export const CHAT_GENERATED: readonly GeneratedCommands[] = [
    {
        prefix: CHAT_MOVE_PREFIX,
        usage: 'chatMoveProject',
        palette: false,
        icon: Folder,
        run: (projectId) => {
            const facts = activeViewFacts();
            if (facts !== null && facts.offers.moveToProject && !facts.working) {
                moveChatDialog.set({ chatId: facts.view.id, mode: 'pick', projectId });
            }
        }
    }
];
