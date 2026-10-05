import type { EditorCodeVisionEntry } from './types.ts';

/* What decides whether a row has to be drawn again: the words and the icons, never the handlers, which a press looks up at the time. */
export function lensSignature(entries: readonly EditorCodeVisionEntry[]): string {
    return entries.map((entry) => `${entry.id}\0${entry.text}\0${entry.icon ?? ''}`).join('\n');
}

/*
 * The entries of a row as buttons. A press looks its entry up when it happens, so an entry the host set
 * after the row was drawn is the one that answers.
 */
export function fillLens(container: HTMLElement, entries: readonly EditorCodeVisionEntry[], lookup: (id: string) => EditorCodeVisionEntry | undefined): void {
    const document = container.ownerDocument;
    container.classList.add('se-lens');
    for (const entry of entries) {
        const button = document.createElement('button');
        button.type = 'button';
        button.className = 'se-lens-entry';
        button.tabIndex = -1;
        if (entry.icon !== undefined) {
            const icon = document.createElement('span');
            icon.className = `se-lens-icon se-lens-icon-${entry.icon}`;
            icon.setAttribute('aria-hidden', 'true');
            button.append(icon);
        }
        button.append(entry.text);
        // The editor keeps the focus, so the caret stays where it was and a popover can hand the keyboard back.
        button.addEventListener('pointerdown', (event) => event.preventDefault());
        button.addEventListener('click', () => lookup(entry.id)?.activate(button.getBoundingClientRect()));
        container.append(button);
    }
}
