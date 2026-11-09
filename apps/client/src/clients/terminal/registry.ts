import { MAX_TERMINAL_READ_LINES } from '@ruimte/actions';
import type { Terminal } from '@xterm/xterm';
import { browserRegistry, useBrowser } from '@/clients/browser/registry';
import { focusedCanvas } from '@/state/canvas';
import { currentEndpointId } from '@/state/current-endpoint';
import { endpointKey } from '@/state/keys';

/* What a window keeps of a terminal out of sight: the lines `terminal.read` may ask for, and how many of them its screen showed. */
interface LastScreen {
    lines: string[];
    rows: number;
}

/*
 * Live xterm instances, and the last screen of the ones that were unmounted. Keyed on the machine
 * as well as the node, so a terminal of one daemon never repaints with another daemon's screen. A
 * remount draws from `session.attach`, never from here, so the whole scrollback need not stay.
 */
const live = new Map<string, Terminal>();
const lastScreens = new Map<string, LastScreen>();
/* Live terminals whose node left the document; the node leaves before React unmounts it, so its unmount must not keep a screen. */
const forgotten = new WeakSet<Terminal>();

function screenLines(term: Terminal, limit = Infinity): string[] {
    const buffer = term.buffer.active;
    const lineAt = (index: number): string => buffer.getLine(index)?.translateToString(true) ?? '';
    let end = buffer.length;

    while (end > 0 && lineAt(end - 1) === '') {
        end--;
    }

    const lines: string[] = [];

    for (let i = Math.max(0, end - limit); i < end; i++) {
        lines.push(lineAt(i));
    }

    return lines;
}

export function registerTerminal(endpointId: string, nodeId: string, term: Terminal): () => void {
    const key = endpointKey(endpointId, nodeId);
    live.set(key, term);
    return () => {
        if (live.get(key) === term) {
            live.delete(key);
        }

        if (!forgotten.has(term)) {
            lastScreens.set(key, { lines: screenLines(term, Math.max(MAX_TERMINAL_READ_LINES, term.rows)), rows: term.rows });
        }
    };
}

export function focusTerminal(endpointId: string, nodeId: string): void {
    live.get(endpointKey(endpointId, nodeId))?.focus();
}

/* The rows the terminal showed when it was last on screen, for the plate that stands in for it. */
export function lastScreenOf(endpointId: string, nodeId: string): string[] {
    const screen = lastScreens.get(endpointKey(endpointId, nodeId));

    return screen === undefined ? [] : screen.lines.slice(-screen.rows);
}

/* What a terminal holds now, or its last lines when it was last on screen; null for one this window never drew. */
export function screenOf(endpointId: string, nodeId: string): string[] | null {
    const key = endpointKey(endpointId, nodeId);
    const term = live.get(key);

    if (term !== undefined) {
        return screenLines(term);
    }

    return lastScreens.get(key)?.lines ?? null;
}

export function forgetScreen(endpointId: string, nodeId: string): void {
    const key = endpointKey(endpointId, nodeId);
    const term = live.get(key);

    if (term !== undefined) {
        forgotten.add(term);
    }

    lastScreens.delete(key);
}

/* What the desktop smoke run (`apps/desktop/src/smoke.ts`) drives a browser node through. */
interface TerminalTestHooks {
    /* Node ids on the canvas, in stacking order. */
    nodeIds(): string[];
    browserState(nodeId: string): unknown;
    browserNavigate(nodeId: string, url: string): void;
}

declare global {
    interface Window {
        ruimte?: TerminalTestHooks;
    }
}

export function exposeTerminalTestHooks(): void {
    window.ruimte = {
        nodeIds() {
            return focusedCanvas().getState().order;
        },
        browserState(nodeId) {
            return useBrowser.getState().byKey[endpointKey(currentEndpointId(), nodeId)] ?? null;
        },
        browserNavigate(nodeId, url) {
            browserRegistry.navigate(endpointKey(currentEndpointId(), nodeId), url);
        }
    };
}
