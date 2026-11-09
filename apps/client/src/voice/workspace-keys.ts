import { isApplePlatform, isInFloatingLayer } from '@adecore/ui';
import { commandForKey } from '@/commands/registry';
import type { WorkspaceKeys } from '@/commands/workspace-keys';
import { startVoice, stopVoice } from '@/voice/controller';
import { createVoiceShortcut } from '@/voice/shortcut';
import { useVoice } from '@/voice/state';

export function voiceKeys(): WorkspaceKeys {
    const voiceShortcut = createVoiceShortcut({
        available: () => useVoice.getState().credential?.configured === true,
        active: () => ['connecting', 'listening', 'closing'].includes(useVoice.getState().phase),
        start: () => {
            void startVoice();
        },
        stop: stopVoice
    });

    return {
        capture(event) {
            if (event.isComposing || isInFloatingLayer(event.target) || commandForKey('workspace', event, isApplePlatform()) !== 'voice-control') {
                return false;
            }
            if (voiceShortcut.press(event.timeStamp, event.repeat)) {
                event.preventDefault();
                event.stopPropagation();
            }

            return true;
        },
        keyup: (event) => voiceShortcut.release(event),
        blur: () => voiceShortcut.blur(),
        dispose: () => voiceShortcut.blur()
    };
}
