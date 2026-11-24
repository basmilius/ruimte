import { definedLanguageOf, MAX_LANGUAGE_GRAMMAR_BYTES } from '@ruimte/contracts';
import { useContributions } from '@/state/extension-registry';

/*
 * The language a file is colored and served in: what the machine read from its name, or else the language an
 * extension defined for it. The machine's comes first, so a pack never takes a file type Ruimte knows itself.
 */
export function useFileLanguage(path: string, read: string | undefined): string | undefined {
    const languages = useContributions((state) => state.languages);

    return read ?? definedLanguageOf(languages, path)?.language;
}

/* The grammar of a language, from its JSON file in the pack. Throws for one that is too large or no object, in words the author reads. */
export async function fetchGrammar(url: string): Promise<object> {
    const response = await fetch(url);

    if (!response.ok) {
        throw new Error(`the grammar could not be read (${response.status})`);
    }

    const text = await response.text();

    // Counted before it is parsed: a grammar is data of the pack, and the highlighter holds it for as long as the page lives.
    if (new TextEncoder().encode(text).length > MAX_LANGUAGE_GRAMMAR_BYTES) {
        throw new Error(`the grammar is over ${MAX_LANGUAGE_GRAMMAR_BYTES / 1024} KB`);
    }

    const grammar: unknown = JSON.parse(text);

    if (typeof grammar !== 'object' || grammar === null || typeof (grammar as { scopeName?: unknown }).scopeName !== 'string') {
        throw new Error('the grammar is no TextMate grammar: it has no scopeName');
    }

    return grammar;
}
