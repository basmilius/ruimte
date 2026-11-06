import { sendFromComposer, stepEffortFromComposer, stepTimelineMessage } from '@adecore/agents-react/chat';
import { isInFloatingLayer } from '@adecore/ui';
import { Folder } from 'lucide-react';
import { focusedChatComposerKey, focusedChatId, keyboardChatKey } from '@/chat/focused-chat';
import { CHAT_MOVE_PREFIX } from '@/chat/menu-extras';
import { openForkDialog } from '@/chat/open-fork';
import { restartChatSession } from '@/chat/restart-session';
import { defineBehaviors, type CommandBehavior, type KeyHandler } from '@/commands/behavior';
import type { GeneratedCommands } from '@/commands/generated';
import { endpointKey } from '@/state/keys';
import { endpointOfNodeId } from '@/state/node-endpoint';
import { useUi } from '@/state/ui';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { activeViewFacts } from '@/views/active-view';

/* The chat the commands mean: the chat view in the focused cell, or the chat node with the keyboard or selected alone. */
function focusedChat(): { id: string; key: string } | null {
    const id = focusedChatId();

    return id === null ? null : { id, key: endpointKey(endpointOfNodeId(id), id) };
}

/* The chat on screen when it can leave Chats: it moves only while it is not working. */
function leavingChatId(): string | null {
    const facts = activeViewFacts();

    return facts !== null && facts.offers.moveToProject && !facts.working ? facts.view.id : null;
}

function withChat(run: (chat: { id: string; key: string }) => void): () => void {
    return () => {
        const chat = focusedChat();
        if (chat !== null) {
            run(chat);
        }
    };
}

const onFocusedChat: Pick<CommandBehavior, 'offered'> = { offered: (moment) => moment.inWorkspace && focusedChatId() !== null };

function steppingEffort(direction: 'up' | 'down'): CommandBehavior {
    return {
        run: withChat(({ key }) => stepEffortFromComposer(key, direction)),
        ...onFocusedChat,
        // The shell drops an accelerator for a key the page saw, and off macOS registers none, so this listener is the only way the key the menu shows acts.
        key: (press) => {
            const key = focusedChatComposerKey();
            if (key !== null && !isInFloatingLayer(press.event.target) && stepEffortFromComposer(key, direction)) {
                press.event.preventDefault();

                return true;
            }

            return false;
        }
    };
}

export const CHAT_BEHAVIORS = defineBehaviors({
    // A frame later, so the keyboard the new chat takes is not handed back to the old one as the palette closes.
    'chat-send-new': { run: withChat(({ key }) => sendFromComposer(key, 'and-new')), ...onFocusedChat, afterClose: true },
    'chat-restart': { run: withChat(({ id }) => void restartChatSession(id)), ...onFocusedChat },
    'chat-effort-up': steppingEffort('up'),
    'chat-effort-down': steppingEffort('down'),
    'chat-message-previous': { run: withChat(({ key }) => stepTimelineMessage(key, -1)), ...onFocusedChat },
    'chat-message-next': { run: withChat(({ key }) => stepTimelineMessage(key, 1)), ...onFocusedChat },
    // The palette cannot grey a row, so a chat that works offers none; the menu says why.
    'chat-make-project': {
        run: () => {
            const chatId = leavingChatId();
            if (chatId !== null) {
                useUi.getState().setMoveChatDialog({ chatId, mode: 'make', projectId: null });
            }
        },
        offered: (moment) => moment.inWorkspace && leavingChatId() !== null
    },
    'chat-move-to-project': {
        run: () => {
            const chatId = leavingChatId();
            if (chatId !== null) {
                useUi.getState().setMoveChatDialog({ chatId, mode: 'pick', projectId: null });
            }
        },
        offered: (moment) => moment.inWorkspace && leavingChatId() !== null
    },
    'search-chats': { run: () => useUi.getState().openChatSearch(), offered: (moment) => moment.inWorkspace },
    'view-fork': {
        run: () => {
            const facts = activeViewFacts();
            if (facts !== null && facts.forkTurn !== null) {
                openForkDialog(facts.view.id, facts.forkTurn);
            }
        }
    }
});

/* From the thread only: the composer keeps these for its prompt recall. Nothing is taken when the chat has no message that way, so the canvas still moves between nodes. */
export const CHAT_KEY_HANDLERS: readonly KeyHandler[] = [
    (press) => {
        const previous = press.is(CANVAS_SHORTCUTS.previousMessage);
        if (!previous && !press.is(CANVAS_SHORTCUTS.nextMessage)) {
            return false;
        }
        const key = keyboardChatKey();
        if (key !== null && !isInFloatingLayer(press.event.target) && stepTimelineMessage(key, previous ? -1 : 1)) {
            press.event.preventDefault();

            return true;
        }

        return false;
    }
];

export const CHAT_GENERATED: readonly GeneratedCommands[] = [
    {
        prefix: CHAT_MOVE_PREFIX,
        usage: 'chatMoveProject',
        palette: false,
        icon: Folder,
        run: (projectId) => {
            const facts = activeViewFacts();
            if (facts !== null && facts.offers.moveToProject && !facts.working) {
                useUi.getState().setMoveChatDialog({ chatId: facts.view.id, mode: 'pick', projectId });
            }
        }
    }
];
