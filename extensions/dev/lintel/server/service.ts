/*
 * The Lintel service, as this extension would reach a linter: its rules, as fixed data. No linter runs and nothing
 * is fetched; `lint.ts` applies them to the text of a file.
 */

export interface Rule {
    /* What a problem names it by. */
    code: string;
    severity: 'warning' | 'information' | 'hint';
    /* Where a line breaks it, as a column from 1 and how many characters, or null where it holds. */
    find(line: string): { column: number; length: number } | null;
    message(line: string): string;
}

export const MAX_LINE_LENGTH = 120;

const MARKER = /\b(TODO|FIXME)\b/;

export const RULES: readonly Rule[] = [
    {
        code: 'marker',
        severity: 'information',
        find: (line) => {
            const found = MARKER.exec(line);

            return found === null ? null : { column: found.index + 1, length: found[0].length };
        },
        message: (line) => `A ${MARKER.exec(line)?.[0] ?? 'TODO'} is left here`
    },
    {
        code: 'line-length',
        severity: 'warning',
        find: (line) => (line.length > MAX_LINE_LENGTH ? { column: MAX_LINE_LENGTH + 1, length: line.length - MAX_LINE_LENGTH } : null),
        message: (line) => `This line is ${line.length} characters long, and ${MAX_LINE_LENGTH} is the most`
    },
    {
        code: 'trailing-space',
        severity: 'hint',
        find: (line) => {
            const trimmed = line.trimEnd();

            return trimmed.length === line.length || trimmed === '' ? null : { column: trimmed.length + 1, length: line.length - trimmed.length };
        },
        message: () => 'Space is left at the end of this line'
    }
];

/* The files Lintel reads, by the end of their name. */
export const CHECKED = ['.ts', '.tsx', '.js', '.jsx', '.css', '.md', '.json', '.yaml'];

/* Folders it never goes into: what a tool wrote, not a person. */
export const SKIPPED = ['node_modules', 'dist', 'build', 'vendor'];
