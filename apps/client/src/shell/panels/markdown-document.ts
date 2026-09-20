import { parseDocument } from 'yaml';
import { absoluteOf, isAbsolutePath } from '@ruimte/contracts';

export interface MarkdownDocument {
    body: string;
    rows: [string, string][] | null;
    invalid: boolean;
}

export function parseMarkdownDocument(text: string): MarkdownDocument {
    const match = /^\uFEFF?---[ \t]*\r?\n([\s\S]*?)^(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/m.exec(text);
    if (!match || match.index !== 0) {
        return { body: text, rows: null, invalid: false };
    }
    try {
        const document = parseDocument(match[1]!, { uniqueKeys: true });
        if (document.errors.length > 0 || document.warnings.length > 0) {
            throw new Error('Invalid frontmatter');
        }
        // Frontmatter is display data. Reject aliases rather than expanding untrusted YAML graphs.
        const value: unknown = document.toJS({ maxAliasCount: 0 });
        if (value !== null && (typeof value !== 'object' || Array.isArray(value))) {
            throw new Error('Frontmatter must be a mapping');
        }
        const rows = Object.entries(value ?? {}).map(([key, entry]): [string, string] => [
            key,
            typeof entry === 'string' ? entry : JSON.stringify(entry, null, 2)
        ]);
        return { body: text.slice(match[0].length), rows, invalid: false };
    } catch {
        return { body: text, rows: null, invalid: true };
    }
}

export function markdownImagePath(src: string, folder: string | null): string | null {
    if (!src || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(src)) {
        return null;
    }
    try {
        const path = decodeURIComponent(src.split(/[?#]/, 1)[0]!);
        return isAbsolutePath(path) ? path : folder === null ? null : absoluteOf(folder, path);
    } catch {
        return null;
    }
}
