import type { FitAddon } from '@xterm/addon-fit';
import { Terminal } from '@xterm/xterm';
import { isApplePlatform } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { isAppShortcut, isClearShortcut, isLeaveNodeShortcut, isTerminalPaste, macMotionSequence } from '@/terminal/keymap';
import { readTerminalFont, readTerminalTheme } from '@/terminal/theme';

/* ESC CR: what agent CLIs read as "newline, do not submit". Harmless in a plain shell. */
const SHIFT_ENTER = '\x1b\r';

export function createTerminal(): Terminal {
    return new Terminal({
        theme: readTerminalTheme(),
        fontFamily: readTerminalFont(),
        fontSize: useSettings.getState().fontSize,
        cursorBlink: true,
        scrollback: 5000,
        macOptionIsMeta: true
    });
}

/*
 * FitAddon measures the host's border box, so a vertical padding on the host would count as room for a
 * row that is cut off. The host has none; what a whole row does not fill is split above and below, as an
 * offset rather than a padding, since FitAddon subtracts the terminal element's own padding too.
 */
export function fitToHost(term: Terminal, fit: FitAddon): void {
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
}

interface Pointer {
    clientX: number;
    clientY: number;
}

interface MouseService {
    getCoords(event: Pointer, element: HTMLElement, ...rest: unknown[]): unknown;
    getMouseReportCoords(event: Pointer, element: HTMLElement): unknown;
}

/** Where a pointer would stand on an element whose ancestors scale it from its layout size to `rect`. */
export function unscaledPointer(
    pointer: Pointer,
    rect: Pick<DOMRect, 'left' | 'top' | 'width' | 'height'>,
    layout: { width: number; height: number }
): Pointer {
    const scaleX = layout.width > 0 && rect.width > 0 ? rect.width / layout.width : 1;
    const scaleY = layout.height > 0 && rect.height > 0 ? rect.height / layout.height : 1;
    return {
        clientX: rect.left + (pointer.clientX - rect.left) / scaleX,
        clientY: rect.top + (pointer.clientY - rect.top) / scaleY
    };
}

/*
 * xterm measures a pointer against the screen's scaled bounding box but divides by unscaled cells, so
 * under the camera's scale() a selection or a click lands rows off, more so further down. Its one mouse
 * service (private, shared by selection, links and mouse reporting) gets the pointer as it would stand
 * without the transform. Call after `open`, which creates that service.
 */
export function followAncestorScale(term: Terminal): void {
    const mouse = (term as unknown as { _core: { _mouseService?: MouseService } })._core._mouseService;
    if (!mouse) {
        return;
    }
    const unscaled = (pointer: Pointer, element: HTMLElement): Pointer =>
        unscaledPointer(pointer, element.getBoundingClientRect(), { width: element.offsetWidth, height: element.offsetHeight });
    const getCoords = mouse.getCoords.bind(mouse);
    const getMouseReportCoords = mouse.getMouseReportCoords.bind(mouse);
    mouse.getCoords = (event, element, ...rest) => getCoords(unscaled(event, element), element, ...rest);
    mouse.getMouseReportCoords = (event, element) => getMouseReportCoords(unscaled(event, element), element);
}

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
export function bindTerminalKeys(term: Terminal, keys: TerminalKeys): void {
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
}
