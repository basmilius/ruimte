import { useEffect } from 'react';
import { answerWindowKey } from '@/commands/key-dispatch';
import { isApplePlatform } from '@/desktop/bridge';
import { runActionShortcut } from '@/extensions/action-shortcuts';

/* Mounted once by the app; a second listener would toggle the palette open and shut again. */
export function useAppShortcuts(): void {
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
