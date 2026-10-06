import { fenceOf, lineRangeLabel } from '@/chat/selection-to-chat';
import type { LineSpan, InlineProblem } from '@adecore/editor-react/models';

export interface InlineRequest {
    readonly instruction: string;
    /* The path as the project stores it: relative to the folder, absolute outside it. */
    readonly path: string;
    /* The highlighter id of the file's language, or null for plain text. */
    readonly language: string | null;
    readonly span: LineSpan;
    readonly text: string;
    readonly problems: readonly InlineProblem[];
}

const MAX_PROBLEMS = 20;

// The daemon owns the answer format; the client sends the person's instruction and selected code.
export function inlineMessage(request: InlineRequest): string {
    const body = request.text.replace(/\n+$/, '');
    const fence = fenceOf(body);
    const parts = [
        request.instruction.trim(),
        `File: @${request.path}\nSelected lines ${lineRangeLabel(request.path, request.span.startLine, request.span.endLine)}:\n${fence}${request.language ?? ''}\n${body}\n${fence}`
    ];
    if (request.problems.length > 0) {
        const lines = request.problems
            .slice(0, MAX_PROBLEMS)
            .map((problem) => `- line ${problem.line}: ${problem.severity}: ${problem.message}${problem.code === '' ? '' : ` (${problem.code})`}`);
        parts.push(`Problems the language servers report on these lines:\n${lines.join('\n')}`);
    }
    return parts.join('\n\n');
}
