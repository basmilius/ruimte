import { create } from 'zustand';
import { focusPromptStart } from '@ruimte/agents-react/prompts/logic/focus';
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

export const bringPromptToFront = (nodeId: string): void => usePromptFront.getState().bringToFront(nodeId);

export const PROMPT_STACK_ATTRIBUTE = 'data-prompt-stack';

/* Where the keyboard was before the shortcut took it to a card, so Escape can hand it back there. */
let returnFocus: HTMLElement | null = null;

/* Puts the keyboard on the front card of the focused canvas. False when that canvas has no prompt. */
export const focusPromptStack = (): boolean => {
    const viewId = useDocument.getState().activeViewId;
    if (viewId === null) {
        return false;
    }
    const stack = document.querySelector<HTMLElement>(`[${PROMPT_STACK_ATTRIBUTE}="${CSS.escape(viewId)}"]`);
    if (!stack?.querySelector('.prompt-card')) {
        return false;
    }
    const current = document.activeElement;
    if (current instanceof HTMLElement && !current.closest(`[${PROMPT_STACK_ATTRIBUTE}]`)) {
        returnFocus = current;
    }
    return focusPromptStart(stack);
};

export const isInPromptStack = (target: EventTarget | null): boolean => target instanceof Element && target.closest(`[${PROMPT_STACK_ATTRIBUTE}]`) !== null;

/* Escape from a card: back to where the keyboard was, or to the canvas when that is gone. */
export const leavePromptStack = (): void => {
    const target = returnFocus;
    returnFocus = null;
    if (target !== null && target.isConnected && !isInPromptStack(target)) {
        target.focus({ preventScroll: true });
        return;
    }
    (document.activeElement as HTMLElement | null)?.blur();
};
