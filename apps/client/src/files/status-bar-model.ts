const LANGUAGE_NAMES: Record<string, string> = {
    typescript: 'TypeScript',
    tsx: 'TypeScript React',
    javascript: 'JavaScript',
    jsx: 'JavaScript React',
    vue: 'Vue',
    php: 'PHP',
    html: 'HTML',
    css: 'CSS',
    scss: 'SCSS',
    less: 'Less',
    json: 'JSON',
    jsonc: 'JSON with Comments',
    json5: 'JSON5',
    yaml: 'YAML',
    toml: 'TOML',
    markdown: 'Markdown',
    mdx: 'MDX',
    python: 'Python',
    ruby: 'Ruby',
    rust: 'Rust',
    go: 'Go',
    java: 'Java',
    kotlin: 'Kotlin',
    swift: 'Swift',
    csharp: 'C#',
    cpp: 'C++',
    c: 'C',
    sql: 'SQL',
    shellscript: 'Shell Script',
    xml: 'XML',
    graphql: 'GraphQL',
    docker: 'Dockerfile',
    diff: 'Diff',
    svelte: 'Svelte',
    astro: 'Astro'
};

/* The name a status bar gives a highlighter id, or null for plain text, which has no name worth showing. */
export function languageNameOf(language: string | undefined): string | null {
    if (language === undefined || language === 'text') {
        return null;
    }
    return LANGUAGE_NAMES[language] ?? language.charAt(0).toUpperCase() + language.slice(1);
}

/* How the file ends its lines, by its first line break; a file without one is written with LF. */
export function lineEndingOf(text: string): 'LF' | 'CRLF' | 'CR' {
    const match = /\r\n|\r|\n/.exec(text);
    return match?.[0] === '\r\n' ? 'CRLF' : match?.[0] === '\r' ? 'CR' : 'LF';
}

/* The file read says `utf-8`, and a status bar writes it the way editors have for years. */
export function encodingLabelOf(encoding: string): string {
    return encoding.toUpperCase();
}

/* The letter in the small badge before the symbol the caret is in. */
export function symbolBadgeOf(kind: string | undefined): string {
    switch (kind) {
        case 'function':
        case 'method':
        case 'constructor':
            return 'f';
        case 'class':
            return 'c';
        case 'interface':
            return 'i';
        case 'enum':
            return 'e';
        case 'namespace':
        case 'module':
        case 'package':
            return 'm';
        case 'property':
        case 'field':
            return 'p';
        case 'variable':
        case 'constant':
            return 'v';
        default:
            return kind === undefined ? '' : kind.charAt(0);
    }
}
