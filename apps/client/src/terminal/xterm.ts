import type { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { isApplePlatform } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { isAppShortcut, isClearShortcut, isLeaveNodeShortcut, isTerminalPaste, macMotionSequence } from '@/terminal/keymap';
import { readTerminalFont, readTerminalTheme } from '@/terminal/theme';

/* ESC CR: what agent CLIs read as "newline, do not submit". Harmless in a plain shell. */
const SHIFT_ENTER = '\x1b\r';

export const createTerminal = (): Terminal =>
    new Terminal({
        theme: readTerminalTheme(),
        fontFamily: readTerminalFont(),
        fontSize: useSettings.getState().fontSize,
        cursorBlink: true,
        scrollback: 5000,
        macOptionIsMeta: true
    });

/*
 * FitAddon measures the host's border box, so a vertical padding on the host would count as room for a
 * row that is cut off. The host has none; what a whole row does not fill is split above and below, as an
 * offset rather than a padding, since FitAddon subtracts the terminal element's own padding too.
 */
export const fitToHost = (term: Terminal, fit: FitAddon): void => {
    fit.fit();
    const host = term.element?.parentElement;
    // The same private dimensions FitAddon itself divides by.
    const cellHeight: number = (term as unknown as { _core: { _renderService: { dimensions: { css: { cell: { height: number } } } } } })._core._renderService
        .dimensions.css.cell.height;
    if (!host || cellHeight === 0) {
        return;
    }
    const slack = host.clientHeight - term.rows * cellHeight;
    host.style.setProperty('--term-offset', `${Math.max(0, Math.floor(slack / 2))}px`);
};

interface TerminalKeys {
    write(data: string): void;
    clear(): void;
    /* Whether the leave shortcut hands Escape back to the window, which a node on a canvas does and a terminal in a dialog does not. */
    leaves: boolean;
}

/*
 * The keys a terminal takes before xterm does, the same in a node and in a dialog. A focused terminal
 * has the keyboard the way a native one does: every shortcut the app does not need to move between
 * views stops here instead of reaching the window listeners. The ones it does need are the window's
 * alone, or xterm would write Cmd+Shift+Enter as a return.
 */
export const bindTerminalKeys = (term: Terminal, keys: TerminalKeys): void => {
    term.attachCustomKeyEventHandler((e) => {
        const apple = isApplePlatform();
        if (e.key === 'Escape') {
            // Escape is the program's (an interrupt, a mode change); only the leave shortcut returns
            // to the canvas, and it does so by falling through to the window listener unwritten.
            if (keys.leaves && isLeaveNodeShortcut(e, apple)) {
                return false;
            }
            // The canvas and a dialog listen above, where any Escape would clear the selection or close it.
            e.stopPropagation();
            return true;
        }
        if (isAppShortcut(e, apple)) {
            return false;
        }
        e.stopPropagation();
        if (e.type !== 'keydown') {
            return true;
        }
        if (isClearShortcut(e, apple)) {
            e.preventDefault();
            keys.clear();
            return false;
        }
        // Neither written nor prevented, so the browser's own paste lands in xterm's textarea.
        if (isTerminalPaste(e, apple)) {
            return false;
        }
        if (apple) {
            const motion = macMotionSequence(e, term.modes.applicationCursorKeysMode);
            if (motion) {
                e.preventDefault();
                keys.write(motion);
                return false;
            }
        }
        if (e.key === 'Enter' && e.shiftKey) {
            e.preventDefault();
            keys.write(SHIFT_ENTER);
            return false;
        }
        return true;
    });
};
