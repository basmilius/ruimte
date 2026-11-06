import { useEffect } from 'react';
import { answerWorkspaceKey, answerWorkspaceKeyEarly } from '@/commands/key-dispatch';
import { createWorkspaceKeys } from '@/commands/workspace-keys';

/*
 * The one listener of the workspace's keys, bound on `window` once per workspace so a split grid does not
 * run the same project shortcut in every canvas. It holds no key of its own: the rows of the command table
 * that bind here answer through their feature's behavior (`commands/key-dispatch.ts`), and a feature's
 * held or released keys come in as `WorkspaceKeys` (`commands/workspace-keys.ts`).
 */
export function useCanvasShortcuts(): void {
    useEffect(() => {
        const keys = createWorkspaceKeys();
        const onKeyDownCapture = (e: KeyboardEvent): void => {
            for (const listener of keys) {
                if (listener.capture?.(e)) {
                    return;
                }
            }
            if (!e.isComposing) {
                answerWorkspaceKeyEarly(e);
            }
        };
        const onKeyDown = (e: KeyboardEvent): void => {
            // A key something on the page already acted on is that thing's: the views of a database cell mark the keys they took that way.
            if (e.defaultPrevented || e.isComposing) {
                return;
            }
            if (keys.some((listener) => listener.keydown?.(e))) {
                return;
            }
            answerWorkspaceKey(e);
        };
        const onKeyUp = (e: KeyboardEvent): void => {
            for (const listener of keys) {
                listener.keyup?.(e);
            }
        };
        const onPaste = (e: ClipboardEvent): void => {
            for (const listener of keys) {
                listener.paste?.(e);
            }
        };
        const onBlur = (): void => {
            for (const listener of keys) {
                listener.blur?.();
            }
        };
        window.addEventListener('paste', onPaste);
        window.addEventListener('keydown', onKeyDownCapture, true);
        window.addEventListener('keydown', onKeyDown);
        window.addEventListener('keyup', onKeyUp, true);
        window.addEventListener('blur', onBlur);

        return () => {
            window.removeEventListener('paste', onPaste);
            window.removeEventListener('keydown', onKeyDownCapture, true);
            window.removeEventListener('keydown', onKeyDown);
            window.removeEventListener('keyup', onKeyUp, true);
            window.removeEventListener('blur', onBlur);
            for (const listener of keys) {
                listener.dispose?.();
            }
        };
    }, []);
}
