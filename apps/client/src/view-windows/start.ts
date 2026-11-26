import { auxWindowId } from '@/state/window-target';
import { provideWindowCarry } from '@/surface/view-drag';
import { startAuxWindow } from './aux-window';
import { carryToWindows, watchDragOut } from './drag';
import { startMainWindow } from './main-window';
import { canMoveViews } from './messages';

/* Runs once per workspace, in the role this page has. */
export function startViewWindows(): () => void {
    if (!canMoveViews()) {
        return () => undefined;
    }

    provideWindowCarry(carryToWindows);
    const stops = [auxWindowId() === null ? startMainWindow() : startAuxWindow(), watchDragOut()];

    return () => {
        provideWindowCarry(null);

        for (const stop of stops) {
            stop();
        }
    };
}
