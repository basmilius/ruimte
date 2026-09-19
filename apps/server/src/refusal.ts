/*
 * How every no reads: `refused`, the code a script branches on and the sentence a model reads, and
 * under it a line per thing the actor can do instead. One row per line, and a line is a row of
 * tab-separated fields of its own, so only a newline is taken out of it: that would split the row in
 * two, and everything under the first row is read as advice.
 */

/* A field that goes into a tab-separated line; a tab or a newline in a title would split the row. */
export const field = (value: string): string => value.replace(/[\t\r\n]+/g, ' ');

const row = (line: string): string => line.replace(/[\r\n]+/g, ' ');

const rows = (code: string, message: string, lines: readonly string[]): string[] => [`${field(code)}\t${field(message)}`, ...lines.map(row)];

/* What a verb is refused with, whole: the `refused` row and what to do instead under it. */
export const refusalBody = (code: string, message: string, lines: readonly string[] = []): string => {
    const [first, ...rest] = rows(code, message, lines);
    return [`refused\t${first}`, ...rest].join('\n');
};

/*
 * The same without the word that names it, which is what the daemon answers a refused read with:
 * `ruimte-context` puts the prefix on, so a CLI of an older build still prints one refusal.
 */
export const refusalRows = (code: string, message: string, lines: readonly string[] = []): string => rows(code, message, lines).join('\n');

export interface ParsedRefusal {
    code: string;
    message: string;
    lines: string[];
}

/* Reads either form back. Null when the text is no refusal at all, which is not the same as one without advice. */
export const parseRefusalBody = (text: string): ParsedRefusal | null => {
    const [first = '', ...lines] = text.split('\n').filter((line) => line.trim() !== '');
    const parts = first.split('\t');
    const [code, message] = parts[0] === 'refused' ? parts.slice(1) : parts;
    if (!code || !message) {
        return null;
    }
    return { code, message, lines };
};
