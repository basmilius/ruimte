/* A Monaco language id and the Shiki grammar its tokens provider is built from. */
export interface MonacoLanguage {
    readonly id: string;
    readonly grammar: string;
}

/*
 * The Shiki ids that have a Monaco language service, and which Monaco id and grammar each becomes.
 * A tokens provider belongs to a language id and never learns which model it tokenizes, so two
 * files under one id get one grammar. TypeScript keeps its own grammar, since the TSX one reads a
 * generic arrow function as a tag and colors the rest of the file as text; TSX, JSX and JavaScript
 * share Monaco's `javascript` id under the TSX grammar, which reads all three. Both ids run the same
 * TypeScript language service, which tells TSX from TypeScript by the extension on the model's URI.
 */
const SERVICED: Readonly<Record<string, MonacoLanguage>> = {
    typescript: { id: 'typescript', grammar: 'typescript' },
    tsx: { id: 'javascript', grammar: 'tsx' },
    javascript: { id: 'javascript', grammar: 'tsx' },
    jsx: { id: 'javascript', grammar: 'tsx' },
    json: { id: 'json', grammar: 'jsonc' },
    jsonc: { id: 'json', grammar: 'jsonc' },
    css: { id: 'css', grammar: 'css' },
    scss: { id: 'scss', grammar: 'scss' },
    less: { id: 'less', grammar: 'less' },
    html: { id: 'html', grammar: 'html' }
};

/* Any other Shiki id is its own Monaco id, with nothing but its colors and the words in the file. */
export const monacoLanguageOf = (shikiId: string): MonacoLanguage => SERVICED[shikiId] ?? { id: shikiId, grammar: shikiId };

export type WorkerKind = 'editor' | 'typescript' | 'css' | 'json' | 'html';

const WORKER_LABELS: Readonly<Record<string, WorkerKind>> = {
    typescript: 'typescript',
    javascript: 'typescript',
    css: 'css',
    scss: 'css',
    less: 'css',
    json: 'json',
    html: 'html',
    handlebars: 'html',
    razor: 'html'
};

/* Which worker a label Monaco asks for runs in; its own base worker takes every label no language service uses. */
export const workerFor = (label: string): WorkerKind => WORKER_LABELS[label] ?? 'editor';

/*
 * Where a model lives. The path goes in whole so a language service reads the dialect off its
 * extension, under a segment of its own per model: two editors on one file are two models, and
 * Monaco refuses a second model at a URI it already holds.
 */
export const modelPath = (sequence: number, path: string | undefined): string => {
    const file = path === undefined || path === '' ? '' : path.startsWith('/') ? path : `/${path}`;
    return `/${sequence}${file}`;
};
