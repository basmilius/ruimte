import { focusedChatId } from '@/chat/focused-chat';
import { focusedChatTextSize } from '@/chat/text-size';
import type { MenuFacts, MenuHost } from '@/commands/menu-context';
import { moveTargetsOf } from '@/project/move-targets';
import { newChatMachine, offersNewChat, useNewChat } from '@/project/new-chat';
import { currentEndpointId } from '@/state/current-endpoint';
import { useEndpoints } from '@/state/endpoints';
import { useProjectList } from '@/state/project-list';
import { activeViewFacts } from '@/views/active-view';
import { windowWorkspace } from '@/workspace/window';

declare module '@/commands/menu-context' {
    interface MenuFacts {
        /* A chat has the focus: the chat view in the focused cell, or the chat node with the keyboard or selected alone (`focused-chat.ts`). */
        chat: boolean;
        /* The reading size of the focused chat, 0 to 3, or null while no chat is focused. */
        chatTextSize: number | null;
        /* The chat in the focused cell runs a turn or waits on a person, so it cannot move now. */
        chatWorking: boolean;
        /* The projects of this machine a chat in Chats can move to, most recently touched first. */
        moveProjects: { id: string; name: string }[];
        /* A chat outside any project can start from this window (`project/new-chat.ts`). */
        newChat: boolean;
    }
}

export function chatFacts(_host: MenuHost): Pick<MenuFacts, 'chat' | 'chatTextSize' | 'chatWorking' | 'moveProjects' | 'newChat'> {
    const facts = activeViewFacts();
    const endpointId = currentEndpointId();

    return {
        chat: windowWorkspace() !== null && focusedChatId() !== null,
        chatTextSize: windowWorkspace() !== null ? focusedChatTextSize() : null,
        chatWorking: facts?.working ?? false,
        moveProjects:
            facts?.offers.moveToProject === true
                ? moveTargetsOf(useProjectList.getState().projects, useEndpoints.getState().endpoints, endpointId).map((summary) => ({
                      id: summary.projectId,
                      name: summary.name
                  }))
                : [],
        newChat: offersNewChat(newChatMachine(), useNewChat.getState().refused)
    };
}
