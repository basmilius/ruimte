/*
 * The shape of the file every line is put back into: what ends a line here, and whether the last one
 * is ended at all. A resolution that loses either rewrites the whole file on the next diff.
 */
export interface TextShape {
    eol: '\n' | '\r\n';
    finalNewline: boolean;
}

/* The line ending a file uses, by the first one in it, and whether it ends on one. */
export const shapeOf = (text: string): TextShape => {
    const line = text.indexOf('\n');
    return {
        eol: line > 0 && text[line - 1] === '\r' ? '\r\n' : '\n',
        finalNewline: text === '' || text.endsWith('\n')
    };
};

/* The lines of a file, without the empty one a trailing newline would leave behind. */
export const splitLines = (text: string): string[] => {
    if (text === '') {
        return [];
    }
    const lines = text.split(/\r\n|\n/);
    if (lines[lines.length - 1] === '') {
        lines.pop();
    }
    return lines;
};

export const joinLines = (lines: readonly string[], shape: TextShape): string =>
    lines.length === 0 ? '' : lines.join(shape.eol) + (shape.finalNewline ? shape.eol : '');
