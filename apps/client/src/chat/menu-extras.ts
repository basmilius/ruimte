import { only, submenu, t } from '@/commands/menu-builders';
import type { MenuExtra } from '@/commands/menu-extras';

/* The Move to Project submenu's row per recent project, which moves the chat on screen there. */
export const CHAT_MOVE_PREFIX = 'chat-move-project-';

export const CHAT_MENU_EXTRAS: readonly MenuExtra[] = [
    {
        menu: 'kind',
        group: 'place',
        order: 6,
        build: (context, _command, itemsOf) =>
            only(context.offers?.moveToProject === true, submenu('chat-move', t('moveToProject'), itemsOf('chat-move'), !context.chatWorking))
    },
    {
        menu: 'chat-move',
        group: 'recent',
        order: 10,
        build: (context, command) => context.moveProjects.map((project) => command(`${CHAT_MOVE_PREFIX}${project.id}`, project.name))
    }
];
