/* What the model returns for a continuation, trimmed to what belongs at the caret. */

export const GHOST_MAX_LINES = 8;

const FENCE_OPEN = /^```[\w+#.-]*[ \t]*\n/;
const FENCE_CLOSE = /\n?```[ \t]*$/;

function depthOf(text: string): number {
    let depth = 0;
    for (const character of text) {
        if (character === '(' || character === '{' || character === '[') {
            depth++;
        } else if (character === ')' || character === '}' || character === ']') {
            depth--;
        }
    }
    return depth;
}

const trimmed = (lines: readonly string[]): string[] => lines.map((line) => line.trim());

/*
 * A small model often writes the line it was asked to continue again, and the lines that close the block
 * after the caret. The lines before the caret that come back at the start of the answer are dropped, and
 * so are closing lines at its end that the text after the caret already has, as long as the answer would
 * otherwise close more than it opens.
 */
export function cleanGhost(output: string, before: string, after: string): string {
    let text = output.replace(/\r\n/g, '\n').replace(FENCE_OPEN, '').replace(FENCE_CLOSE, '').replace(/\s+$/, '');
    if (text.trim() === '') {
        return '';
    }
    text = dropEcho(text, before);
    text = dropTrailingDuplicates(text, after);
    const lines = text.split('\n').slice(0, GHOST_MAX_LINES);
    return lines.join('\n').replace(/\s+$/, '');
}

function dropEcho(text: string, before: string): string {
    const beforeLines = before.split('\n');
    const typed = beforeLines.at(-1)!.trim();
    const earlier = trimmed(beforeLines.slice(0, -1)).filter((line) => line !== '');
    const lines = text.split('\n');
    const first = trimmed(lines);
    // How many whole lines before the cursor line the answer starts with again, the closest ones first.
    let matched = 0;
    for (let count = Math.min(earlier.length, lines.length); count > 0; count--) {
        const tail = earlier.slice(earlier.length - count);
        if (tail.every((line, index) => line === first[index])) {
            matched = count;
            break;
        }
    }
    if (matched > 0) {
        lines.splice(0, matched);
    }
    // The cursor line itself, when something is typed on it already: the answer repeats it and goes on.
    const head = lines[0]?.trimStart() ?? '';
    if (typed !== '' && (matched > 0 || typed.length >= 4) && head.startsWith(typed)) {
        lines[0] = head.slice(typed.length);
    } else if (matched > 0 && typed === '') {
        // The echoed lines took the indentation of the cursor line with them, which the caret already has.
        lines[0] = lines[0]?.trimStart() ?? '';
    }
    return lines.join('\n');
}

function dropTrailingDuplicates(text: string, after: string): string {
    if (depthOf(text) >= 0) {
        return text;
    }
    const afterLines = trimmed(after.split('\n')).filter((line) => line !== '');
    const lines = text.split('\n');
    const tail = trimmed(lines);
    for (let count = Math.min(afterLines.length, lines.length); count > 0; count--) {
        if (tail.slice(tail.length - count).every((line, index) => line === afterLines[index])) {
            return lines.slice(0, lines.length - count).join('\n');
        }
    }
    return text;
}

/* The first word of a suggestion with the whitespace before it, which is what Option+] takes. */
export function firstWord(text: string): string {
    const match = /^\s*(?:[\p{L}\p{N}_$]+|[^\p{L}\p{N}_$\s]+)/u.exec(text);
    return match === null ? text : match[0];
}
