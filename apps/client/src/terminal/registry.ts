import type { Terminal } from '@xterm/xterm';
import { browserRegistry, useBrowser } from '@/browser/registry';
import { useCanvas } from '@/state/canvas';
import { webglBudget } from '@/terminal/webgl-budget';

/* Live xterm instances by node id, and the last screen of the ones that were unmounted. */
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

export const registerTerminal = (nodeId: string, term: Terminal): (() => void) => {
    live.set(nodeId, term);
    return () => {
        if (live.get(nodeId) === term) {
            live.delete(nodeId);
        }
        lastScreens.set(nodeId, screenLines(term));
    };
};

export const lastScreenOf = (nodeId: string): string[] => lastScreens.get(nodeId) ?? [];

export const forgetScreen = (nodeId: string): void => {
    lastScreens.delete(nodeId);
};

export interface TerminalTestHooks {
    terminalText(nodeId: string): string | null;
    terminalSize(nodeId: string): { cols: number; rows: number } | null;
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
        terminalText(nodeId) {
            const term = live.get(nodeId);
            return term ? screenLines(term).join('\n') : null;
        },
        terminalSize(nodeId) {
            const term = live.get(nodeId);
            return term ? { cols: term.cols, rows: term.rows } : null;
        },
        nodeIds() {
            return useCanvas.getState().order;
        },
        webglContexts() {
            return webglBudget.holders();
        },
        browserState(nodeId) {
            return useBrowser.getState().byNodeId[nodeId] ?? null;
        },
        browserNavigate(nodeId, url) {
            browserRegistry.navigate(nodeId, url);
        },
        canvas() {
            return useCanvas.getState();
        }
    };
};
