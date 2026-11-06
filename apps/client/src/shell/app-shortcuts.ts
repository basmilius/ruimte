import { isApplePlatform } from '@adecore/ui';
import { useEffect } from 'react';
import { answerWindowKey } from '@/commands/key-dispatch';
import { runActionShortcut } from '@/extensions/action-shortcuts';
import { createUsagePeek, useUsagePeekShown } from '@/shell/usage-peek';

function useUsagePeek(): void {
    useEffect(() => {
        const peek = createUsagePeek((shown) => useUsagePeekShown.setState({ shown }), {
            set: (run, ms) => window.setTimeout(run, ms),
            clear: (handle) => window.clearTimeout(handle)
        });
        const onKeyDown = (e: KeyboardEvent): void => peek.keyDown(e);
        const onKeyUp = (e: KeyboardEvent): void => peek.keyUp(e);
        const onPointerDown = (): void => peek.pointerDown();
        const onPointerUp = (): void => peek.pointerUp();
        const onBlur = (): void => peek.blur();

        window.addEventListener('keydown', onKeyDown, true);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('pointerdown', onPointerDown, true);
        window.addEventListener('pointerup', onPointerUp, true);
        window.addEventListener('pointercancel', onPointerUp, true);
        window.addEventListener('blur', onBlur);

        return () => {
            window.removeEventListener('keydown', onKeyDown, true);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('pointerdown', onPointerDown, true);
            window.removeEventListener('pointerup', onPointerUp, true);
            window.removeEventListener('pointercancel', onPointerUp, true);
            window.removeEventListener('blur', onBlur);
            peek.blur();
        };
    }, []);
}

/* Mounted once by the app; a second listener would toggle the palette open and shut again. */
export function useAppShortcuts(): void {
    useUsagePeek();

    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            // A key something on the page already acted on is that thing's, such as Run all in a database console.
            if (e.defaultPrevented) {
                return;
            }
            // Ruimte's own first, so an extension never takes a key from it.
            if (!answerWindowKey(e)) {
                runActionShortcut(e, isApplePlatform());
            }
        };
        window.addEventListener('keydown', onKeyDown);

        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
}
