import { useSubagentView } from '@adecore/agents-react/chat';
import { isInFloatingLayer } from '@adecore/ui';
import { keyboardChatKey } from '@/chat/focused-chat';
import { isPlainEscape, type WorkspaceKeys } from '@/commands/workspace-keys';
import { isTypingTarget } from '@/surface/canvas/typing-target';

export function chatKeys(): WorkspaceKeys {
    return {
        // A chat that shows a sub-agent goes one level back up first, the way a drawing clears its selection before it lets go of the keyboard.
        capture(event) {
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
