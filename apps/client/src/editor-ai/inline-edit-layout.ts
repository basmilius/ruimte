import type { InlineProblem } from './inline-edit-model';

/* How many problems the question names as chips; the rest are counted. */
export const MAX_PROBLEM_CHIPS = 3;
/* The characters of a problem a chip shows before it ends in an ellipsis, so one long message never takes the row. */
export const PROBLEM_CHIP_CHARS = 48;

const SEVERITY_RANK = { error: 0, warning: 1, info: 2, hint: 3 } as const;

export interface ProblemChips {
    readonly shown: readonly InlineProblem[];
    readonly hidden: readonly InlineProblem[];
}

/* The worst problems first, and among equals the first line, so the chips are what most needs a look. */
export function problemChips(problems: readonly InlineProblem[], max = MAX_PROBLEM_CHIPS): ProblemChips {
    const ranked = [...problems].sort((left, right) => SEVERITY_RANK[left.severity] - SEVERITY_RANK[right.severity] || left.line - right.line);
    return { shown: ranked.slice(0, max), hidden: ranked.slice(max) };
}

/* The chip's text: the line and the first line of the message, cut to `PROBLEM_CHIP_CHARS` with an ellipsis. */
export function problemLabel(problem: InlineProblem, limit = PROBLEM_CHIP_CHARS): string {
    const message = problem.message.split('\n')[0]!.trim();
    const label = `${problem.line}: ${message}`;
    return label.length <= limit ? label : `${label.slice(0, limit - 1).trimEnd()}…`;
}

/* What the tooltip of a chip says: the whole message, and the server's code when it gave one. */
export function problemDetail(problem: InlineProblem): string {
    const message = problem.message.trim();
    return problem.code === '' ? message : `${message} (${problem.code})`;
}
