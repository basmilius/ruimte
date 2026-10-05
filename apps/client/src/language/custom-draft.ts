import { isValidFilePattern, type CustomLanguageServer, type CustomLanguageServerInput } from '@ruimte/contracts';

/* A server of a person's own as the dialog edits it: every list is the text of a field. */
export interface CustomDraft {
    /* Absent for a server that is not saved yet. */
    id?: string;
    name: string;
    command: string;
    /* One argument per line, kept as typed, spaces included. */
    args: string;
    /* `NAME=value` per line. */
    env: string;
    /* Language ids, separated by commas, spaces or lines. */
    languages: string;
    /* One file pattern per line, since a pattern may hold commas in its braces. */
    patterns: string;
    /* JSON, or empty for none. */
    options: string;
    scope: 'all' | 'some';
    projects: string[];
}

export type DraftProblem = 'name' | 'command' | 'serves' | 'pattern' | 'env' | 'options' | 'projects';

export function emptyDraft(): CustomDraft {
    return { name: '', command: '', args: '', env: '', languages: '', patterns: '', options: '', scope: 'all', projects: [] };
}

export function formatEnv(env: Readonly<Record<string, string>>): string {
    return Object.entries(env)
        .map(([name, value]) => `${name}=${value}`)
        .join('\n');
}

export function draftOf(server: CustomLanguageServer): CustomDraft {
    return {
        id: server.id,
        name: server.name,
        command: server.command,
        args: server.args.join('\n'),
        env: formatEnv(server.env),
        languages: server.languages.join(', '),
        patterns: server.patterns.join('\n'),
        options: server.initializationOptions === undefined ? '' : JSON.stringify(server.initializationOptions, null, 2),
        scope: server.projects === undefined ? 'all' : 'some',
        projects: server.projects ?? []
    };
}

function lines(text: string): string[] {
    return text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line !== '');
}

export function parseArgs(text: string): string[] {
    return text.split(/\r?\n/).filter((line) => line !== '');
}

export function parseLanguages(text: string): string[] {
    return text
        .split(/[\s,]+/)
        .map((language) => language.trim())
        .filter((language) => language !== '');
}

export function parsePatterns(text: string): string[] {
    return lines(text);
}

/* Null for a line that is not `NAME=value`. */
export function parseEnv(text: string): Record<string, string> | null {
    const env: Record<string, string> = {};
    for (const line of lines(text)) {
        const at = line.indexOf('=');
        if (at < 1 || /\s/.test(line.slice(0, at))) {
            return null;
        }
        env[line.slice(0, at)] = line.slice(at + 1);
    }
    return env;
}

/* `undefined` for nothing, and a failure for text that is not JSON. */
export function parseOptions(text: string): { value: unknown } | null {
    if (text.trim() === '') {
        return { value: undefined };
    }
    try {
        return { value: JSON.parse(text) as unknown };
    } catch {
        return null;
    }
}

/* The first thing wrong with a draft, in the order the dialog reads, or null when it can be saved. */
export function problemOf(draft: CustomDraft): DraftProblem | null {
    if (draft.name.trim() === '') {
        return 'name';
    }
    if (draft.command.trim() === '') {
        return 'command';
    }
    if (parseLanguages(draft.languages).length + parsePatterns(draft.patterns).length === 0) {
        return 'serves';
    }
    if (!parsePatterns(draft.patterns).every(isValidFilePattern)) {
        return 'pattern';
    }
    if (parseEnv(draft.env) === null) {
        return 'env';
    }
    if (parseOptions(draft.options) === null) {
        return 'options';
    }
    if (draft.scope === 'some' && draft.projects.length === 0) {
        return 'projects';
    }
    return null;
}

/* What the daemon is asked to save. Only for a draft with no problem. */
export function inputOf(draft: CustomDraft): CustomLanguageServerInput {
    const options = parseOptions(draft.options)?.value;
    return {
        ...(draft.id === undefined ? {} : { id: draft.id }),
        name: draft.name.trim(),
        command: draft.command.trim(),
        args: parseArgs(draft.args),
        env: parseEnv(draft.env) ?? {},
        languages: parseLanguages(draft.languages),
        patterns: parsePatterns(draft.patterns),
        ...(options === undefined ? {} : { initializationOptions: options }),
        ...(draft.scope === 'some' ? { projects: draft.projects } : {})
    };
}
