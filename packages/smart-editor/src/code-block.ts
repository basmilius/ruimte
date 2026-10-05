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
        if (options.faded) {
            code.dataset.faded = 'true';
        }
        const emphasis = options.emphasis?.[index] ?? [];
        if (emphasis.length > 0 && options.color !== undefined) {
            row.style.setProperty('--se-emphasis', colorValue(options.color));
        }
        fill(code, line, tokens?.[index] ?? null, emphasis);
        row.append(gutter, code);
        block.append(row);
    });
    container.append(block);
}

function fill(element: HTMLElement, line: string, tokens: readonly LineToken[] | null, emphasis: ReadonlyArray<readonly [number, number]>): void {
    if (tokens === null && emphasis.length === 0) {
        element.textContent = line;
        return;
    }
    const spans: Array<{ start: number; end: number; token: LineToken | null }> = [];
    let start = 0;
    for (const token of tokens ?? []) {
        const end = Math.min(line.length, start + token.length);
        if (end > start) {
            spans.push({ start, end, token });
        }
        start = end;
    }
    if (start < line.length) {
        spans.push({ start, end: line.length, token: null });
    }
    for (const { start: from, end: to, token } of spans) {
        // A token is cut at the edges of every emphasis that crosses it, so each piece is one color and either on or off.
        const cuts = [...new Set([from, to, ...emphasis.flatMap((range) => range).filter((cut) => cut > from && cut < to)])].sort(
            (left, right) => left - right
        );
        for (let i = 0; i < cuts.length - 1; i++) {
            const piece = element.ownerDocument.createElement('span');
            piece.textContent = line.slice(cuts[i]!, cuts[i + 1]!);
            if (token !== null) {
                styleSpan(piece, token);
            }
            if (emphasis.some(([emphasisStart, emphasisEnd]) => emphasisStart <= cuts[i]! && cuts[i + 1]! <= emphasisEnd)) {
                piece.className = 'se-code-emphasis';
            }
            element.append(piece);
        }
    }
}
