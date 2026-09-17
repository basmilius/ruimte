export const LABEL_SIZE = 14;
export const SUB_SIZE = 12;
export const LABEL_LINE = 18;
export const SUB_LINE = 16;

const NARROW = new Set([..."ijl.,:;!|'"]);
const SEMI = new Set([...' ftrI-()[]{}/\\`"*']);
const WIDE_LOWER = new Set([...'mw']);
const WIDE = new Set([...'MW@%&']);

/*
 * The width of a glyph as a share of the font size, per class of character. Measured in Chromium
 * for the system face (SF on macOS) and Helvetica as a stand-in for Inter and Segoe UI, taking the
 * wider of the two at weight 600, so an estimate errs towards a box that is a little too wide.
 */
const ratioOf = (char: string): number => {
    if (NARROW.has(char)) {
        return 0.3;
    }
    if (SEMI.has(char)) {
        return 0.4;
    }
    if (WIDE_LOWER.has(char)) {
        return 0.86;
    }
    if (WIDE.has(char)) {
        return 1;
    }
    if (char >= 'a' && char <= 'z') {
        return 0.6;
    }
    if (char >= 'A' && char <= 'Z') {
        return 0.74;
    }
    if (char >= '0' && char <= '9') {
        return 0.64;
    }
    // CJK and everything after it is set on a full em; any other letter is taken as a wide Latin one.
    return char.codePointAt(0)! >= 0x2e80 ? 1 : 0.64;
};

const REGULAR = 0.94;

/* No DOM in this package, so text is estimated rather than measured, the same way on every machine. */
export const estimateTextWidth = (text: string, size: number, bold = false): number => {
    let units = 0;
    for (const char of text) {
        units += ratioOf(char);
    }
    return Math.ceil(units * size * (bold ? 1 : REGULAR));
};

const breakWord = (word: string, size: number, bold: boolean, maxWidth: number): string[] => {
    const pieces: string[] = [];
    let piece = '';
    for (const char of word) {
        if (piece !== '' && estimateTextWidth(piece + char, size, bold) > maxWidth) {
            pieces.push(piece);
            piece = '';
        }
        piece += char;
    }
    pieces.push(piece);
    return pieces;
};

export const wrapText = (text: string, size: number, bold: boolean, maxWidth: number): string[] => {
    const words = text
        .trim()
        .split(/\s+/)
        .filter((word) => word !== '');
    const lines: string[] = [];
    let line = '';
    for (const word of words) {
        const pieces = estimateTextWidth(word, size, bold) > maxWidth ? breakWord(word, size, bold, maxWidth) : [word];
        for (const piece of pieces) {
            const joined = line === '' ? piece : `${line} ${piece}`;
            if (line !== '' && estimateTextWidth(joined, size, bold) > maxWidth) {
                lines.push(line);
                line = piece;
            } else {
                line = joined;
            }
        }
    }
    lines.push(line);
    return lines;
};

export const widestLine = (lines: readonly string[], size: number, bold: boolean): number =>
    lines.reduce((widest, line) => Math.max(widest, estimateTextWidth(line, size, bold)), 0);
