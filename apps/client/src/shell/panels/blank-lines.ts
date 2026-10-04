import type { EditorContentChange } from '@ruimte/smart-editor';

const BLANK = /^[ \t]+$/;

/* The edits that empty every line holding only spaces and tabs, except `keepLine` (zero-based), where the caret may be about to type. */
export function blankLineEdits(text: string, keepLine: number | null): EditorContentChange[] {
    const edits: EditorContentChange[] = [];
    text.split('\n').forEach((raw, line) => {
        const content = raw.endsWith('\r') ? raw.slice(0, -1) : raw;
        if (line !== keepLine && BLANK.test(content)) {
            edits.push({ range: { start: { line, character: 0 }, end: { line, character: content.length } }, text: '' });
        }
    });
    return edits;
}

export function collapseBlankLines(text: string): string {
    return text.replace(/^[ \t]+(?=\r?$)/gm, '');
}
