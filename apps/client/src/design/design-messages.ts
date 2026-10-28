import type { DesignElement } from '@/design/design-protocol';

/* A comment waiting to be sent, on the element a person picked. */
export interface DesignComment {
    element: DesignElement;
    text: string;
}

function where(element: DesignElement): string {
    const option = element.option === null ? '' : `option ${element.option}, `;
    return `${option}${element.name} (\`${element.selector}\`), ${Math.round(element.rect.width)}×${Math.round(element.rect.height)}`;
}

function excerpt(element: DesignElement): string {
    return element.html === '' ? '' : `\n   ${element.html.replace(/\s+/g, ' ').trim()}`;
}

/*
 * The comments of one round as one message, so the chat takes them in one turn. Each names the
 * element the way the agent finds it again: its option, its selector and a piece of its markup.
 */
export function commentsPrompt(file: string, comments: readonly DesignComment[]): string {
    const lines = comments.map((comment, index) => `${index + 1}. On ${where(comment.element)}:${excerpt(comment.element)}\n   ${comment.text.trim()}`);

    return [`Comments on ${file}. Change only the elements they are on, and keep the rest of the design as it is.`, '', ...lines].join('\n');
}

/* Text a person changed in place, which the agent writes into the source, since the page only showed it. */
export function textEditPrompt(file: string, element: DesignElement, before: string, after: string): string {
    return [
        `In ${file}, I changed the text of ${where(element)} in place. Write it into the source and change nothing else.`,
        '',
        `Before: ${before.trim()}`,
        `After: ${after.trim()}`
    ].join('\n');
}

/* A drawing over the canvas, with what it was drawn over. */
export function drawPrompt(file: string, elements: readonly DesignElement[], note: string): string {
    const over = elements.length === 0 ? 'the canvas' : elements.map(where).join('; ');

    return [
        `I drew on ${file}, over ${over}. The attached image is the drawing as it lay over the page.`,
        '',
        note.trim() === '' ? 'Change the design the way the drawing shows.' : note.trim()
    ].join('\n');
}

/* What the overrides block holds, folded into the source by the agent so the block can go. */
export function bakePrompt(file: string, css: string): string {
    return [
        `I adjusted ${file} by hand; the changes are the rules in its \`<style id="ruimte-edits">\` block. Fold each into the source of the element it targets, then remove the block. The design must look exactly the same afterwards.`,
        '',
        '```css',
        css.trim(),
        '```'
    ].join('\n');
}

/* The first message of a chat that builds a design into the project. */
export function implementPrompt(path: string, file: string): string {
    return `Implement the design in \`${path}/${file}\` in this project, with its own components, styles and conventions rather than the design's HTML. Read the project first, follow what it already does, and ask before you choose between options the design leaves open.`;
}
