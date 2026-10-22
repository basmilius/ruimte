import { useEffect, useMemo } from 'react';
import { desktop } from '@/desktop/bridge';
import { LOCAL_ENDPOINT_ID } from '@/state/endpoints';

/* The two methods of the desktop shell Quick Look runs on. */
export interface QuickLookShell {
    previewFile(path: string): Promise<boolean>;
    closeFilePreview(): void;
}

/* The shell's Quick Look for a project on this machine, or null: a file on another machine is not on this disk. */
export function quickLookShell(endpointId: string): QuickLookShell | null {
    const bridge = desktop();
    if (endpointId !== LOCAL_ENDPOINT_ID || bridge?.platform !== 'darwin') {
        return null;
    }
    const { previewFile, closeFilePreview } = bridge;
    if (typeof previewFile !== 'function' || typeof closeFilePreview !== 'function') {
        return null;
    }
    return { previewFile: (path) => previewFile(path), closeFilePreview: () => closeFilePreview() };
}

/* Space with no modifier and not held down, the one bare key a file row answers. */
export function isQuickLookKey(event: { key: string; repeat: boolean; shiftKey: boolean; metaKey: boolean; ctrlKey: boolean; altKey: boolean }): boolean {
    return event.key === ' ' && !event.repeat && !event.shiftKey && !event.metaKey && !event.ctrlKey && !event.altKey;
}

/*
 * Whether Quick Look is up, as far as this page can tell. The shell says nothing when Quick Look
 * closes on its own keys, but it holds the keyboard while it is up, so the window getting it back
 * (`released`) means it closed or a person clicked past it.
 */
export class QuickLook {
    private showing: string | null = null;
    private readonly shell: QuickLookShell;

    constructor(shell: QuickLookShell) {
        this.shell = shell;
    }

    get open(): boolean {
        return this.showing !== null;
    }

    toggle(path: string): void {
        if (this.showing === null) {
            this.show(path);
        } else {
            this.close();
        }
    }

    /* Moves an open Quick Look on to the row the focus went to, and leaves a closed one closed. */
    follow(path: string): void {
        if (this.showing !== null && this.showing !== path) {
            this.show(path);
        }
    }

    /* True when there was one to close. */
    close(): boolean {
        if (this.showing === null) {
            return false;
        }
        this.showing = null;
        this.shell.closeFilePreview();
        return true;
    }

    released(): void {
        this.showing = null;
    }

    private show(path: string): void {
        this.showing = path;
        const forget = (): void => {
            if (this.showing === path) {
                this.showing = null;
            }
        };
        this.shell
            .previewFile(path)
            .then((shown) => {
                if (!shown) {
                    forget();
                }
            })
            .catch(forget);
    }
}

/* Quick Look for the files of one project folder, closed again when the folder or the panel goes. */
export function useQuickLook(endpointId: string, folder: string | null): QuickLook | null {
    const quickLook = useMemo(() => {
        const shell = folder === null ? null : quickLookShell(endpointId);
        return shell === null ? null : new QuickLook(shell);
    }, [endpointId, folder]);

    useEffect(() => {
        if (quickLook === null) {
            return;
        }
        const onFocus = (): void => quickLook.released();
        window.addEventListener('focus', onFocus);
        return () => {
            window.removeEventListener('focus', onFocus);
            quickLook.close();
        };
    }, [quickLook]);

    return quickLook;
}
