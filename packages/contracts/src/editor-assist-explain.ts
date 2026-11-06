import { boundLines, UNTRUSTED_CODE } from './editor-assist-text.ts';

export const EXPLAIN_SOURCE_MAX = 4000;
export const EXPLAIN_DOCUMENTATION_MAX = 800;

export const EXPLAIN_INSTRUCTIONS = [
    'You explain source code to a developer who is reading it.',
    'Answer in two to four plain sentences about what the code does, what it returns and any condition worth knowing.',
    'Write in the language the request names, English when it names none.',
    'No headings, no bullet points, no code blocks and no greeting. Never repeat the code.',
    UNTRUSTED_CODE
].join(' ');

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
