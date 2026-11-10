import { isInFloatingLayer, isApplePlatform } from '@adecore/ui';
import { onStandaloneView } from '@/commands/key-context';
import type { WorkspaceKeys } from '@/commands/workspace-keys';
import { focusViewRow } from '@/sidebar/sidebar-focus';
import { activeViewOf, useDocument } from '@/state/document';
import { drawingHasSomethingToClear, focusedDrawing } from '@/state/drawing';
import { isLeaveNodeShortcut } from '@/surface/terminal-keymap';

/*
 * A view of its own has no canvas to fall back to, so leaving its body puts the keyboard on its row
 * in the sidebar. A chat leaves on Escape; a terminal hands Escape to the program it runs and leaves
 * on the same shortcut a terminal node uses.
 */
function leaveStandaloneView(event: KeyboardEvent): void {
    const state = useDocument.getState();
    const view = activeViewOf(state);
    if (view === null || !state.bodyFocused) {
        return;
    }
    const leaving = view.kind === 'terminal' ? isLeaveNodeShortcut(event, isApplePlatform()) : !event.metaKey && !event.ctrlKey && !event.altKey;
    if (!leaving) {
        return;
    }
    // A drawing clears its draft, its selection and its tool first, also when its own listener hears the key after this one.
    if (view.kind === 'drawing' && drawingHasSomethingToClear(focusedDrawing().getState())) {
        return;
    }
    event.preventDefault();
    state.setBodyFocused(false);
    focusViewRow(view.id);
}

export function sidebarKeys(): WorkspaceKeys {
    return {
        keydown(event) {
            if (event.key !== 'Escape' || isInFloatingLayer(event.target) || !onStandaloneView()) {
                return false;
            }
            leaveStandaloneView(event);

            return true;
        }
    };
}
