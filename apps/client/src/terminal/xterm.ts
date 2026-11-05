import type { TerminalSize, TerminalViewHandle } from '@adecore/terminal';
import type { Terminal } from '@xterm/xterm';
import type { SessionClient } from '@/clients/terminal/session-client';
import { isApplePlatform } from '@/desktop/bridge';
import { isAppShortcut, isClearShortcut, isLeaveNodeShortcut, isTerminalFindShortcut, isTerminalPaste, macMotionSequence } from '@/surface/terminal-keymap';

/* ESC CR: what agent CLIs read as "newline, do not submit". Harmless in a plain shell. */
const SHIFT_ENTER = '\x1b\r';

const keyedTerminals = new WeakSet<Element>();
const findableTerminals = new WeakSet<Element>();

interface TerminalKeys {
    write(data: string): void;
    clear(): void;
    /* Opens the find bar. A terminal without one (a login dialog) leaves the key to its program. */
    find?: () => void;
    /* Whether the leave shortcut hands Escape back to the window, which a node on a canvas does and a terminal in a dialog does not. */
    leaves: boolean;
}

/*
 * The keys a terminal takes before xterm does, the same in a node and in a dialog. A focused terminal
 * has the keyboard the way a native one does: every shortcut the app does not need to move between
 * views stops here instead of reaching the window listeners. The ones it does need are the window's
 * alone, or xterm would write Cmd+Shift+Enter as a return.
 */
export function bindTerminalKeys(term: Terminal, keys: TerminalKeys): void {
    if (term.element) {
        keyedTerminals.add(term.element);
        if (keys.find !== undefined) {
            findableTerminals.add(term.element);
        }
    }
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
        if (keys.find !== undefined && isTerminalFindShortcut(e, apple)) {
            e.preventDefault();
            keys.find();
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
}

function keyboardIsIn(terminals: WeakSet<Element>): boolean {
    if (typeof document === 'undefined') {
        return false;
    }
    for (let node = document.activeElement; node !== null; node = node.parentElement) {
        if (terminals.has(node)) {
            return true;
        }
    }
    return false;
}

/* Whether the keyboard is in a terminal that takes its own keys, where the clear key clears instead of opening the palette. */
export function terminalHasKeyboard(): boolean {
    return keyboardIsIn(keyedTerminals);
}

/* Whether that terminal also has a find bar to open; a login dialog has none. */
export function terminalHasFind(): boolean {
    return keyboardIsIn(findableTerminals);
}

/*
 * Draws a session into a view: its output, the grid of a client elsewhere until a resize here claims
 * it back, and the fresh screen after a reattach or a resync. Answers the call that stops it.
 */
export function drawSession(sessions: SessionClient, sessionId: string, view: TerminalViewHandle): () => void {
    const offs = [
        sessions.onOutput(sessionId, (data) => view.write(data)),
        sessions.onSize(sessionId, (size) => view.followGrid(size)),
        sessions.onScreen(sessionId, ({ screen }) => {
            view.reset();
            view.write(screen);
        })
    ];
    return () => offs.forEach((off) => off());
}

/* The grid the terminal fits its host to, or null while the layout has not given that host any room. */
export function fittedGrid(view: TerminalViewHandle): TerminalSize | null {
    const host = view.terminal?.element?.parentElement;
    if (!host || host.clientWidth === 0 || host.clientHeight === 0) {
        return null;
    }
    return view.size();
}
