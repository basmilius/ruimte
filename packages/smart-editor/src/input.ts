import type { Selection, TextEdit } from '@ruimte/smart-editor-core';

/* The one stretch two texts differ in, found from both ends and never inside a surrogate pair. */
export function findChange(before: string, after: string): TextEdit {
    let from = 0;
    while (from < before.length && from < after.length && before[from] === after[from]) {
        from++;
    }
    if (from > 0 && /[\uDC00-\uDFFF]/.test(before[from] ?? '') && /[\uD800-\uDBFF]/.test(before[from - 1]!)) {
        from--;
    }
    let endBefore = before.length;
    let endAfter = after.length;
    while (endBefore > from && endAfter > from && before[endBefore - 1] === after[endAfter - 1]) {
        endBefore--;
        endAfter--;
    }
    if (endBefore < before.length && /[\uDC00-\uDFFF]/.test(before[endBefore] ?? '') && /[\uD800-\uDBFF]/.test(before[endBefore - 1] ?? '')) {
        endBefore++;
        endAfter++;
    }
    return { from, to: endBefore, text: after.slice(from, endAfter) };
}

/* One replacement per selection, with the carets after what each inserted. */
export function replacementEdits(selections: readonly Selection[], text: string): { edits: TextEdit[]; selections: Selection[] } {
    const sorted = selections
        .map((selection, index) => ({ from: Math.min(selection.anchor, selection.head), to: Math.max(selection.anchor, selection.head), index }))
        .sort((left, right) => left.from - right.from);
    const edits: TextEdit[] = [];
    const positions: Selection[] = [];
    let delta = 0;
    for (const range of sorted) {
        edits.push({ from: range.from, to: range.to, text });
        const head = range.from + delta + text.length;
        positions[range.index] = { anchor: head, head };
        delta += text.length - (range.to - range.from);
    }
    return { edits, selections: positions };
}

export function textareaText(text: string): string {
    return text.replace(/\r\n?/g, '\n');
}

/* A textarea normalizes CRLF; the model keeps its own UTF-16 offsets. */
export function modelOffset(text: string, nativeOffset: number): number {
    let native = 0;
    for (let index = 0; index < text.length; index++) {
        if (native === nativeOffset) {
            return index;
        }
        if (text[index] === '\r' && text[index + 1] === '\n') {
            continue;
        }
        native++;
    }
    return text.length;
}

export function textareaOffset(text: string, offset: number): number {
    return textareaText(text.slice(0, offset)).length;
}
