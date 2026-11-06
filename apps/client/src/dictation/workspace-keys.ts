import { isInFloatingLayer, matchesShortcut, isApplePlatform } from '@adecore/ui';
import type { WorkspaceKeys } from '@/commands/workspace-keys';
import { cancelDictation, stopDictation, toggleFocusedDictation, useDictation } from '@/dictation/controller';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';

/* Holding the key past this long dictates only while it is held; a tap toggles. */
const HOLD_MS = 400;

export function dictationKeys(): WorkspaceKeys {
    let press: number | null = null;

    return {
        capture(event) {
            if (!event.isComposing && !isInFloatingLayer(event.target) && matchesShortcut(CANVAS_SHORTCUTS.dictation, event, isApplePlatform())) {
                if (event.repeat) {
                    event.preventDefault();
                    event.stopPropagation();

                    return true;
                }
                const starting = useDictation.getState().phase === 'idle' || useDictation.getState().phase === 'error';
                if (toggleFocusedDictation()) {
                    press = starting ? event.timeStamp : null;
                    event.preventDefault();
                    event.stopPropagation();
                }

                return true;
            }
            if (event.key === 'Escape' && useDictation.getState().targetId !== null) {
                cancelDictation();
                press = null;
                event.preventDefault();
                event.stopPropagation();

                return true;
            }

            return false;
        },
        keyup(event) {
            if (press !== null && (event.code === 'KeyD' || event.key === 'Meta' || event.key === 'Control' || event.key === 'Shift')) {
                if (event.timeStamp - press >= HOLD_MS) {
                    stopDictation();
                }
                press = null;
            }
        },
        blur() {
            press = null;
            cancelDictation();
        },
        dispose: () => cancelDictation()
    };
}
