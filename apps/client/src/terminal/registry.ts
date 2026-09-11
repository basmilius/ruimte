import type { Terminal } from '@xterm/xterm';
import { browserRegistry, useBrowser } from '@/browser/registry';
import { useCanvas } from '@/state/canvas';
import { currentEndpointId, endpointKey } from '@/state/keys';
import { webglBudget } from '@/terminal/webgl-budget';

/*
 * Live xterm instances, and the last screen of the ones that were unmounted. Keyed on the machine
 * as well as the node: a terminal of one daemon must never repaint with another daemon's screen.
 */
const live = new Map<string, Terminal>();
const lastScreens = new Map<string, string[]>();

export const screenLines = (term: Terminal): string[] => {
    const buffer = term.buffer.active;
    const lines: string[] = [];
    for (let i = 0; i < buffer.length; i++) {
        lines.push(buffer.getLine(i)?.translateToString(true) ?? '');
    }
    while (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
};

export const registerTerminal = (endpointId: string, nodeId: string, term: Terminal): (() => void) => {
    const key = endpointKey(endpointId, nodeId);
    live.set(key, term);
    return () => {
        if (live.get(key) === term) {
            live.delete(key);
        }
        lastScreens.set(key, screenLines(term));
    };
};

export const lastScreenOf = (endpointId: string, nodeId: string): string[] => lastScreens.get(endpointKey(endpointId, nodeId)) ?? [];

export const forgetScreen = (endpointId: string, nodeId: string): void => {
    lastScreens.delete(endpointKey(endpointId, nodeId));
};

export interface TerminalTestHooks {
    /* The machine defaults to the active one, which is the only one a canvas shows today. */
    terminalText(nodeId: string, endpointId?: string): string | null;
    terminalSize(nodeId: string, endpointId?: string): { cols: number; rows: number } | null;
    /* Node ids on the canvas, in stacking order. */
    nodeIds(): string[];
    /* Node ids holding a WebGL renderer, highest ranked first. */
    webglContexts(): string[];
    /* What a browser node's page reports, for the desktop smoke test. */
    browserState(nodeId: string): unknown;
    browserNavigate(nodeId: string, url: string): void;
    /* The canvas store itself, for driving the app from a test. */
    canvas(): ReturnType<typeof useCanvas.getState>;
}

declare global {
    interface Window {
        ruimte?: TerminalTestHooks;
    }
}

/* The WebGL renderer leaves no text in the DOM, so an end-to-end test reads the buffer through here. */
export const exposeTerminalTestHooks = (): void => {
    window.ruimte = {
        terminalText(nodeId, endpointId) {
            const term = live.get(endpointKey(endpointId ?? currentEndpointId(), nodeId));
            return term ? screenLines(term).join('\n') : null;
        },
        terminalSize(nodeId, endpointId) {
            const term = live.get(endpointKey(endpointId ?? currentEndpointId(), nodeId));
            return term ? { cols: term.cols, rows: term.rows } : null;
        },
        nodeIds() {
            return useCanvas.getState().order;
        },
        webglContexts() {
            return webglBudget.holders();
        },
        browserState(nodeId) {
            return useBrowser.getState().byKey[endpointKey(currentEndpointId(), nodeId)] ?? null;
        },
        browserNavigate(nodeId, url) {
            browserRegistry.navigate(endpointKey(currentEndpointId(), nodeId), url);
        },
        canvas() {
            return useCanvas.getState();
        }
    };
};
