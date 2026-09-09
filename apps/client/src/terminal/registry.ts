import type { Terminal } from '@xterm/xterm';

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
        }
    };
};
