import { matchesShortcut, shortcut, type KeyLike } from '@/ui/shortcut';

/*
 * The keys inside a prompt card. Bare keys are allowed here and nowhere else on a canvas because a card
 * is a widget the keyboard is already in. They only mean something while the focus is inside one.
 */
export const PROMPT_SHORTCUTS = {
    primary: shortcut('Mod+Enter'),
    previousPrompt: shortcut('Mod+Shift+ArrowLeft'),
    nextPrompt: shortcut('Mod+Shift+ArrowRight')
} as const;

export type PromptKeyEvent = KeyLike & { isComposing: boolean };

export type ListStep = 'previous' | 'next' | 'first' | 'last';

export type ChoiceKeyAction = { kind: 'move'; to: ListStep } | { kind: 'pick' } | { kind: 'pick-and-commit' } | { kind: 'commit' };

export type AnswerFieldKeyAction = { kind: 'to-last-choice' } | { kind: 'commit' } | { kind: 'ignore' };

const isPlain = (event: PromptKeyEvent): boolean => !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && !event.isComposing;

const LIST_KEYS: Record<string, ListStep> = { ArrowUp: 'previous', ArrowDown: 'next', Home: 'first', End: 'last' };
const TOOLBAR_KEYS: Record<string, ListStep> = { ArrowLeft: 'previous', ArrowRight: 'next', Home: 'first', End: 'last' };

/* Both lists wrap, the way a radio group does. */
export const stepIndex = (index: number, count: number, to: ListStep): number => {
    if (count === 0) {
        return -1;
    }
    switch (to) {
        case 'first':
            return 0;
        case 'last':
            return count - 1;
        case 'previous':
            return (index - 1 + count) % count;
        case 'next':
            return (index + 1) % count;
    }
};

/*
 * A choice of a question. Enter on a multi select question only moves on once something is chosen, so
 * the first Enter on an empty question picks the choice instead of doing nothing.
 */
export const choiceKey = (event: PromptKeyEvent, { multiSelect, anyChosen }: { multiSelect: boolean; anyChosen: boolean }): ChoiceKeyAction | null => {
    if (!isPlain(event)) {
        return null;
    }
    const step = LIST_KEYS[event.key];
    if (step) {
        return { kind: 'move', to: step };
    }
    if (event.code === 'Space') {
        return { kind: 'pick' };
    }
    if (event.key === 'Enter') {
        if (!multiSelect) {
            return { kind: 'pick-and-commit' };
        }
        return anyChosen ? { kind: 'commit' } : { kind: 'pick' };
    }
    return null;
};

/* A written answer: under the choices ("Something else…") or the only field of a question without choices. */
export const answerFieldKey = (
    event: PromptKeyEvent,
    { belowChoices, caretAtStart, hasText }: { belowChoices: boolean; caretAtStart: boolean; hasText: boolean }
): AnswerFieldKeyAction | null => {
    if (!isPlain(event)) {
        return null;
    }
    if (event.key === 'ArrowUp' && belowChoices && caretAtStart) {
        return { kind: 'to-last-choice' };
    }
    if (event.key === 'Enter') {
        // An empty answer is not sent, and an empty line in front of the answer is never what Enter meant.
        return hasText ? { kind: 'commit' } : { kind: 'ignore' };
    }
    return null;
};

export const headingKey = (event: PromptKeyEvent): boolean => isPlain(event) && event.key === 'ArrowDown';

export const toolbarKey = (event: PromptKeyEvent): ListStep | null => (isPlain(event) ? (TOOLBAR_KEYS[event.key] ?? null) : null);

export const isPrimaryKey = (event: PromptKeyEvent, apple: boolean): boolean => !event.isComposing && matchesShortcut(PROMPT_SHORTCUTS.primary, event, apple);

/* Paging through a stack. In a text field these keys select to the start or end of the line, so they stay there. */
export const pageKey = (event: PromptKeyEvent, apple: boolean, typing: boolean): -1 | 1 | null => {
    if (typing || event.isComposing) {
        return null;
    }
    if (matchesShortcut(PROMPT_SHORTCUTS.previousPrompt, event, apple)) {
        return -1;
    }
    return matchesShortcut(PROMPT_SHORTCUTS.nextPrompt, event, apple) ? 1 : null;
};

/*
 * A key without Ctrl, Cmd or Alt never leaves a card: arrows would reach the canvas, Space would start a
 * pan and Backspace would delete the selected nodes. Escape and Tab still go on, since they leave the card.
 */
export const staysInCard = (event: PromptKeyEvent): boolean =>
    !event.ctrlKey && !event.metaKey && !event.altKey && event.key !== 'Escape' && event.key !== 'Tab';
