import { z } from 'zod';

/*
 * What a problem source of an extension reports: the `Problem` of `@ruimte/extension/server`. Smaller than a
 * language server's diagnostic, and counted from 1 as a person and an agent read a place in a file. Apart from the
 * manifest's schema, so the test runtime of an extension carries it without the rest of the wire.
 */

// The same ids a manifest lists under `provides` (`ExtensionProvidedIdSchema`).
const ExtensionProvidedIdSchema = z.string().regex(/^[a-z0-9][a-z0-9-]{0,63}$/);

// The most one source says about one file, and the most files it speaks for in one project; past either the machine refuses the report.
export const EXTENSION_PROBLEMS_PER_FILE = 200;
export const EXTENSION_PROBLEM_FILES = 500;
export const EXTENSION_PROBLEM_MESSAGE_MAX = 2_000;

export const EXTENSION_PROBLEM_SEVERITIES = ['error', 'warning', 'information', 'hint'] as const;
export type ExtensionProblemSeverity = (typeof EXTENSION_PROBLEM_SEVERITIES)[number];

const place = z.number().int().min(1);

export const ExtensionProblemSchema = z.object({
    line: place,
    // Absent is the start of the line.
    column: place.optional(),
    // Absent ends where it starts.
    endLine: place.optional(),
    endColumn: place.optional(),
    severity: z.enum(EXTENSION_PROBLEM_SEVERITIES),
    message: z.string().min(1).max(EXTENSION_PROBLEM_MESSAGE_MAX),
    code: z.string().min(1).max(120).optional()
});
export type ExtensionProblem = z.infer<typeof ExtensionProblemSchema>;

export const ExtensionFileProblemsSchema = z.object({
    // Relative to the project folder, or absolute inside it.
    path: z.string().min(1),
    problems: z.array(ExtensionProblemSchema).max(EXTENSION_PROBLEMS_PER_FILE)
});
export type ExtensionFileProblems = z.infer<typeof ExtensionFileProblemsSchema>;

/* The arguments of `problems.report` as they cross to the machine: the project, the source and what it says of each file. */
export const ExtensionProblemsReportSchema = z.tuple([
    z.string().min(1),
    ExtensionProvidedIdSchema,
    z.array(ExtensionFileProblemsSchema).max(EXTENSION_PROBLEM_FILES)
]);

export const ExtensionProblemsClearSchema = z.tuple([z.string().min(1), ExtensionProvidedIdSchema]);

/* The name a source's reports go under in `language.diagnostics`, where a report replaces the last one of the same name for the file. */
export function extensionProblemServer(extension: string, source: string): string {
    return `${extension}/${source}`;
}

const LSP_SEVERITY: Readonly<Record<ExtensionProblemSeverity, number>> = { error: 1, warning: 2, information: 3, hint: 4 };

/* A problem as the editor draws it: an LSP `Diagnostic`, counted from 0, under the name of its source. */
export function extensionProblemDiagnostic(problem: ExtensionProblem, source: string): object {
    const start = { line: problem.line - 1, character: (problem.column ?? 1) - 1 };
    const endLine = problem.endLine ?? problem.line;
    const end = { line: endLine - 1, character: (problem.endColumn ?? (endLine === problem.line ? (problem.column ?? 1) : 1)) - 1 };

    return {
        range: { start, end },
        severity: LSP_SEVERITY[problem.severity],
        message: problem.message,
        source,
        ...(problem.code === undefined ? {} : { code: problem.code })
    };
}
