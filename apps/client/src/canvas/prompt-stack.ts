import { flushSync } from 'react-dom';
import { create } from 'zustand';
import { focusPromptStart } from '@adecore/agents-react/prompts';
import { useDocument } from '@/state/document';

interface PromptFrontStore {
    /* A node whose prompt should come to the front of the stack on its canvas; `seq` makes asking twice news. */
    request: { nodeId: string; seq: number } | null;
    bringToFront(nodeId: string): void;
    consume(seq: number): void;
}

export const usePromptFront = create<PromptFrontStore>((set, get) => ({
    request: null,
    bringToFront(nodeId) {
        set({ request: { nodeId, seq: (get().request?.seq ?? 0) + 1 } });
    },
    consume(seq) {
        if (get().request?.seq === seq) {
            set({ request: null });
        }
    }
}));

export function bringPromptToFront(nodeId: string): void {
    return usePromptFront.getState().bringToFront(nodeId);
}

interface PromptFoldStore {
    /* The canvases whose stack is folded into a bar, by view id. One client's, in memory only: a reload opens every card. */
    folded: ReadonlySet<string>;
    fold(viewId: string): void;
    open(viewId: string): void;
}

export const usePromptFold = create<PromptFoldStore>((set, get) => ({
    folded: new Set(),
    fold(viewId) {
        if (!get().folded.has(viewId)) {
            set({ folded: new Set([...get().folded, viewId]) });
        }
    },
    open(viewId) {
        if (get().folded.has(viewId)) {
            const folded = new Set(get().folded);
            folded.delete(viewId);
            set({ folded });
        }
    }
}));

export const PROMPT_STACK_ATTRIBUTE = 'data-prompt-stack';

/* Where the keyboard was before the shortcut took it to a card, so Escape can hand it back there. */
let returnFocus: HTMLElement | null = null;

/* Puts the keyboard on the front card of the focused canvas, opening a folded stack first. False when that canvas has no prompt. */
export function focusPromptStack(): boolean {
    const viewId = useDocument.getState().activeViewId;
    if (viewId === null) {
        return false;
    }
    // Drawn now, so the card is there to take the keyboard on this same press.
    flushSync(() => usePromptFold.getState().open(viewId));
    const stack = document.querySelector<HTMLElement>(`[${PROMPT_STACK_ATTRIBUTE}="${CSS.escape(viewId)}"]`);
    if (!stack?.querySelector('.prompt-card')) {
        return false;
    }
    const current = document.activeElement;
    if (current instanceof HTMLElement && !current.closest(`[${PROMPT_STACK_ATTRIBUTE}]`)) {
        returnFocus = current;
    }
    return focusPromptStart(stack);
}

export function isInPromptStack(target: EventTarget | null): boolean {
    return target instanceof Element && target.closest(`[${PROMPT_STACK_ATTRIBUTE}]`) !== null;
}

/* Escape from a card: back to where the keyboard was, or to the canvas when that is gone. */
export function leavePromptStack(): void {
    const target = returnFocus;
    returnFocus = null;
    if (target !== null && target.isConnected && !isInPromptStack(target)) {
        target.focus({ preventScroll: true });
        return;
    }
    (document.activeElement as HTMLElement | null)?.blur();
}
