import { useSubagentView } from '@adecore/agents-react/chat';
import { isApplePlatform, isInFloatingLayer } from '@adecore/ui';
import { keyboardChatKey } from '@/chat/focused-chat';
import { resetChatTextSize, stepChatTextSize } from '@/chat/text-size';
import { commandForKey } from '@/commands/registry';
import { countCommand } from '@/commands/usage';
import { isPlainEscape, type WorkspaceKeys } from '@/commands/workspace-keys';
import { useRoutinesStage } from '@/state/routines-stage';
import { useUi } from '@/state/ui';
import { isTypingTarget } from '@/surface/canvas/typing-target';

/*
 * The reading-size keys of a chat. The composer's editor has a keymap of its own, so they are taken in the capture
 * phase, before the editor hears them. A key with no chat to size is left to whatever else answers it, such as the
 * canvas's own zoom.
 */
function answerTextSizeKey(event: KeyboardEvent): boolean {
    if (event.defaultPrevented || event.isComposing || isInFloatingLayer(event.target) || useUi.getState().settings.open || useRoutinesStage.getState().open) {
        return false;
    }

    const command = commandForKey('workspace', event, isApplePlatform());

    if (command !== 'chat-text-larger' && command !== 'chat-text-smaller' && command !== 'zoom-reset') {
        return false;
    }

    const handled = command === 'zoom-reset' ? resetChatTextSize() : stepChatTextSize(command === 'chat-text-larger' ? 1 : -1);

    if (!handled) {
        return false;
    }

    event.preventDefault();
    event.stopPropagation();
    countCommand(command, 'shortcut');

    return true;
}

export function chatKeys(): WorkspaceKeys {
    return {
        capture(event) {
            if (answerTextSizeKey(event)) {
                return true;
            }

            // A chat that shows a sub-agent goes one level back up first, the way a drawing clears its selection before it lets go of the keyboard.
            if (!isPlainEscape(event) || isInFloatingLayer(event.target) || isTypingTarget(event.target)) {
                return false;
            }
            const key = keyboardChatKey();
            if (key !== null && useSubagentView.getState().back(key)) {
                event.preventDefault();
                event.stopPropagation();

                return true;
            }

            return false;
        }
    };
}
