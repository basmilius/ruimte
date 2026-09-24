import { createContext, type RefObject } from 'react';
import { quoteOf } from '@/chat/quote';

/* The text of an answer (`rows/MessageRows.tsx`), the only part of a thread a selection quotes from. */
const ANSWER = '[data-quote-answer]';

/* The thread whose answers the composer below it quotes. A composer outside a thread quotes nothing. */
export const QuoteThreadContext = createContext<RefObject<HTMLElement | null> | null>(null);

const answerAt = (node: Node): Element | null => (node instanceof Element ? node : node.parentElement)?.closest(ANSWER) ?? null;

/*
 * Whether the range selects text a person can see outside the answer. A triple-click on a paragraph
 * ends at the start of the next row, past a heading only a screen reader reads, and still means the
 * paragraph alone.
 */
const selectsOutside = (range: Range, answer: Element): boolean => {
    const walker = document.createTreeWalker(range.commonAncestorContainer, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
        if (!range.intersectsNode(node) || answer.contains(node)) {
            continue;
        }
        const text = node.textContent ?? '';
        const start = node === range.startContainer ? range.startOffset : 0;
        const end = node === range.endContainer ? range.endOffset : text.length;
        const parent = node.parentElement;
        if (text.slice(start, end).trim() !== '' && parent !== null && getComputedStyle(parent).userSelect !== 'none') {
            return true;
        }
    }
    return false;
};

/* The quote the selection makes, when it lies in one answer of this thread. */
export const selectedAnswerQuote = (selection: Selection | null, thread: HTMLElement | null): string | null => {
    if (thread === null || selection === null || selection.isCollapsed || selection.rangeCount === 0) {
        return null;
    }
    const range = selection.getRangeAt(0);
    const answer = answerAt(range.startContainer) ?? answerAt(range.endContainer);
    if (answer === null || !thread.contains(answer)) {
        return null;
    }
    const inside = answer.contains(range.startContainer) && answer.contains(range.endContainer);
    if (!inside && selectsOutside(range, answer)) {
        return null;
    }
    return quoteOf(selection.toString());
};
