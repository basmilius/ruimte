/* Whether a key landed where a person is typing, so a bare key is theirs and not a shortcut. */
export function isTypingTarget(el: EventTarget | null): boolean {
    if (!(el instanceof HTMLElement)) {
        return false;
    }
    return el.isContentEditable || el.tagName === 'INPUT' || el.tagName === 'TEXTAREA';
}
