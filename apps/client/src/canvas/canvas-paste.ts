import type { Point } from '@/canvas-model/math';

/* What answering a paste on the canvas reaches; a test hands in a fake of each. */
export interface CanvasPasteReach {
    /* Whether the keyboard is on the canvas itself, with nothing on it being edited or typed in. */
    onCanvas(target: EventTarget | null): boolean;
    /* The world point under the pointer, or null when it is not over the canvas. */
    pointer(): Point | null;
    createNote(content: string, at: Point | null): void;
}

type PasteEvent = Pick<ClipboardEvent, 'target' | 'clipboardData' | 'defaultPrevented' | 'preventDefault'>;

/* Leading blank lines would leave the note's title empty, and a copied line usually brings its newline along. */
function pastedContent(text: string): string {
    return text.replace(/^(?:[ \t]*\r?\n)+/, '').trimEnd();
}

/*
 * Text pasted on the canvas becomes a note under the pointer, or in the free spot in view the Add menu
 * takes (`at` null) when the pointer is elsewhere. Whatever has the keyboard of its own keeps its paste.
 */
export function answerCanvasPaste(e: PasteEvent, reach: CanvasPasteReach): void {
    if (e.defaultPrevented || !reach.onCanvas(e.target)) {
        return;
    }
    const content = pastedContent(e.clipboardData?.getData('text/plain') ?? '');
    if (content === '') {
        return;
    }
    e.preventDefault();
    reach.createNote(content, reach.pointer());
}
