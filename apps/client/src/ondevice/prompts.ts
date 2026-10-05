/*
 * The text the on-device model reads for each purpose. The instructions are the daemon's
 * (`apps/server/src/ondevice/instructions.ts`); what a client sends is data to read, with the one
 * request of what to do with it on top. The model's window is small, so every part is bounded.
 */

export const EXPLAIN_SOURCE_MAX = 4000;
export const EXPLAIN_DOCUMENTATION_MAX = 800;
const NAMES_SAMPLE_LINES = 8;
const NAMES_LINE_MAX = 160;
const NAMES_CONTEXT_MAX = 700;
const GHOST_BEFORE_LINES = 60;
const GHOST_BEFORE_MAX = 3000;
const GHOST_AFTER_LINES = 15;
const GHOST_AFTER_MAX = 1000;

/* The first lines that fit `max` characters, cut at a line end, with a note when something was left out. */
export function boundLines(text: string, max: number): string {
    if (text.length <= max) {
        return text;
    }
    const lines = text.split('\n');
    const kept: string[] = [];
    let length = 0;
    for (const line of lines) {
        if (length + line.length + 1 > max && kept.length > 0) {
            break;
        }
        kept.push(line.length > max ? line.slice(0, max) : line);
        length += line.length + 1;
    }
    return kept.length === lines.length ? kept.join('\n') : `${kept.join('\n')}\n[the rest is left out]`;
}

/* The last lines that fit, the way `boundLines` keeps the first. */
function boundTail(text: string, maxLines: number, maxChars: number): string {
    const lines = text.split('\n').slice(-maxLines);
    let result = lines.join('\n');
    if (result.length > maxChars) {
        result = result.slice(result.length - maxChars);
        result = result.slice(result.indexOf('\n') + 1);
    }
    return result;
}

function boundHead(text: string, maxLines: number, maxChars: number): string {
    const lines = text.split('\n').slice(0, maxLines);
    let result = lines.join('\n');
    if (result.length > maxChars) {
        result = result.slice(0, result.lastIndexOf('\n', maxChars) < 0 ? maxChars : result.lastIndexOf('\n', maxChars));
    }
    return result;
}

export interface ExplainInput {
    /* The editor's own words for the language, such as `typescript`. */
    readonly language: string;
    readonly file: string;
    /* The signature a server hover showed, when the explanation is of a symbol. */
    readonly signature?: string;
    readonly documentation?: string;
    readonly source: string;
}

/* `answerIn` is the interface language spelled out, since the model follows a request for a language and not a code. */
export function explainPrompt(input: ExplainInput, answerIn: string): string {
    const parts = [
        input.signature === undefined ? 'Explain this code.' : 'Explain this function.',
        `Answer in ${answerIn}.`,
        '',
        `File: ${input.file} (${input.language})`
    ];
    if (input.signature !== undefined) {
        parts.push(`Signature: ${input.signature}`);
    }
    if (input.documentation !== undefined && input.documentation.trim() !== '') {
        parts.push(`Documentation: ${boundLines(input.documentation.trim(), EXPLAIN_DOCUMENTATION_MAX)}`);
    }
    parts.push('', 'Code:', boundLines(input.source, EXPLAIN_SOURCE_MAX));
    return parts.join('\n');
}

export interface NamesInput {
    readonly language: string;
    readonly name: string;
    /* The lines around the one the rename started on. */
    readonly context: string;
    /* Lines the name appears on, in file order, the declaration first when the servers list it. */
    readonly uses: readonly string[];
}

export function namesPrompt(input: NamesInput): string {
    const uses = input.uses.slice(0, NAMES_SAMPLE_LINES).map((line) => line.trim().slice(0, NAMES_LINE_MAX));
    return [
        'Suggest names for this symbol.',
        `Language: ${input.language}`,
        `Current name: ${input.name}`,
        '',
        'Code around it:',
        boundLines(input.context, NAMES_CONTEXT_MAX),
        '',
        'Lines that use it:',
        ...uses
    ].join('\n');
}

export interface GhostInput {
    readonly language: string;
    readonly file: string;
    readonly before: string;
    readonly after: string;
}

/* The text before and after the caret, cut to what the model can take: the lines nearest the caret win. */
export function ghostPrompt(input: GhostInput): string {
    return [
        `Language: ${input.language}`,
        `File: ${input.file}`,
        'Insert code at the cursor, between the text before and the text after.',
        '',
        // The tags touch the text, so the cursor is where the text before ends and the text after starts.
        `<before>\n${boundTail(input.before, GHOST_BEFORE_LINES, GHOST_BEFORE_MAX)}</before>`,
        `<after>${boundHead(input.after, GHOST_AFTER_LINES, GHOST_AFTER_MAX)}</after>`
    ].join('\n');
}
