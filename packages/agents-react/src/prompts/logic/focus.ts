/*
 * Puts the keyboard on where a card is answered: a question's choice or field, else the first of a
 * request's buttons that grants nothing for good. Allow is drawn last and filled, so it only gets the
 * keyboard when it stands alone, and a stray Enter never grants anything. False when `root` holds no card.
 */
export function focusPromptStart(root: ParentNode | null | undefined): boolean {
    const card = root?.querySelector<HTMLElement>('.prompt-card');
    if (!card) {
        return false;
    }
    const start =
        card.querySelector<HTMLElement>('[data-prompt-entry]:not(:disabled)') ??
        card.querySelector<HTMLElement>('[role="toolbar"] button:not(:disabled):not([data-prompt-primary]):not([data-prompt-lasting])') ??
        card.querySelector<HTMLElement>('[data-prompt-primary]:not(:disabled)') ??
        card.querySelector<HTMLElement>('.prompt-heading');
    start?.focus({ preventScroll: true });
    return start !== null;
}

/* Puts the keyboard on a card's heading, where keys typed for something else answer nothing. False when `root` holds no card. */
export function focusPromptHeading(root: ParentNode | null | undefined): boolean {
    const heading = root?.querySelector<HTMLElement>('.prompt-card .prompt-heading');
    heading?.focus({ preventScroll: true });
    return !!heading;
}
