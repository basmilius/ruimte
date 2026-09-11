import { useEffect } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { useCanvas } from '@/state/canvas';
import { useUi } from '@/state/ui';

/*
 * The chords that belong to the window rather than to a project. Each opens a surface that floats
 * over every workspace there is (the palette, the settings, the window's own sidebar), so they are
 * bound once on `window` and are the same key wherever the focus sits.
 *
 * Everything a chord can do to one project (switch views, add a node, undo, zoom, the panel beside
 * it) is not in here: those live in `canvas/Canvas.tsx` and run only for the workspace that has the
 * focus, so with two projects on screen a chord never lands on the other one.
 */
export type AppChord = 'palette' | 'find-in-files' | 'settings' | 'sidebar';

export interface ChordContext {
    /* The keyboard is inside a node, which is what keeps Ctrl+B out of readline's way off macOS. */
    inNode: boolean;
    apple: boolean;
}

/* The pieces of a key event a chord is read from, so a test can hand this one plain object. */
export type ChordKey = Pick<KeyboardEvent, 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'key' | 'code'>;

/*
 * Which window chord a keystroke is, or null for every other key. There is no guard on what has the
 * focus: these work from anywhere, a focused node or a text field included. A focused terminal is the
 * exception, and it stops the chords it owns before this listener (`terminal/keymap.ts`).
 */
export const appChordFor = (e: ChordKey, { inNode, apple }: ChordContext): AppChord | null => {
    const mod = e.metaKey || e.ctrlKey;
    if (!mod) {
        return null;
    }
    if (!e.altKey && !e.shiftKey && e.key === 'k') {
        return 'palette';
    }
    // Shift makes the key uppercase, which is why this compares the code and not the key.
    if (e.shiftKey && e.code === 'KeyF') {
        return 'find-in-files';
    }
    if (!e.altKey && e.key === ',') {
        return 'settings';
    }
    // Ctrl+B is readline's backward-char and tmux's prefix, so off macOS it stays out of a node.
    if (!e.altKey && !e.shiftKey && e.code === 'KeyB' && (apple || !inNode)) {
        return 'sidebar';
    }
    return null;
};

const run = (chord: AppChord): void => {
    const ui = useUi.getState();
    if (chord === 'palette') {
        if (ui.paletteOpen) {
            ui.setPaletteOpen(false);
        } else {
            ui.openPalette();
        }
        return;
    }
    if (chord === 'find-in-files') {
        // Find in files opens the palette, which searches whichever workspace has the focus.
        ui.openFindInFiles();
        return;
    }
    if (chord === 'settings') {
        ui.setSettings({ open: true });
        return;
    }
    ui.toggleSidebar();
};

/* Mounted once by the app; a second listener would toggle the palette open and shut again. */
export const useAppChords = (): void => {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            const chord = appChordFor(e, { inNode: useCanvas.getState().mode.kind === 'node', apple: isApplePlatform() });
            if (chord === null) {
                return;
            }
            e.preventDefault();
            run(chord);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, []);
};
