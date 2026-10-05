import { colorValue, tintValue } from './attribution.ts';
import { styleSpan } from './paint.ts';
import type { EditorCodeBlockOptions, LineToken } from './types.ts';

/*
 * Lines of code that are not part of the document, in the editor's own face, colors and gutter, for a
 * widget row to show text that is not in the file: lines an agent removed, or the other side of a
 * conflict. The gutter column is as wide as the editor's, so the text lines up with the document's.
 */
export function renderCodeBlock(
    container: HTMLElement,
    text: string,
    tokens: readonly (readonly LineToken[])[] | null,
    tabSize: number,
    options: EditorCodeBlockOptions
): void {
    const document = container.ownerDocument;
    const block = document.createElement('div');
    block.className = 'se-code-block';
    block.style.tabSize = String(tabSize);
    const lines = text.split(/\r?\n/);
    lines.forEach((line, index) => {
        const row = document.createElement('div');
        row.className = 'se-code-row';
        if (options.color !== undefined) {
            row.style.background = tintValue(options.color);
        }
        const gutter = document.createElement('div');
        gutter.className = 'se-code-gutter';
        if (options.firstLine !== undefined) {
            const number = document.createElement('span');
            number.textContent = String(options.firstLine + index);
            gutter.append(number);
        }
        if (options.sign) {
            const sign = document.createElement('span');
            sign.className = 'se-line-sign';
            sign.textContent = options.sign;
            if (options.color !== undefined) {
                sign.style.color = colorValue(options.color);
            }
            gutter.append(sign);
        }
        if (options.color !== undefined) {
            const bar = document.createElement('span');
            bar.className = 'se-attribution';
            bar.style.background = colorValue(options.color);
            gutter.append(bar);
        }
        const code = document.createElement('div');
        code.className = 'se-code-text';
        fill(code, line, tokens?.[index] ?? null);
        row.append(gutter, code);
        block.append(row);
    });
    container.append(block);
}

function fill(element: HTMLElement, line: string, tokens: readonly LineToken[] | null): void {
    if (tokens === null) {
        element.textContent = line;
        return;
    }
    let start = 0;
    for (const token of tokens) {
        const end = Math.min(line.length, start + token.length);
        if (end > start) {
            const span = element.ownerDocument.createElement('span');
            span.textContent = line.slice(start, end);
            styleSpan(span, token);
            element.append(span);
        }
        start = end;
    }
    if (start < line.length) {
        element.append(line.slice(start));
    }
}
