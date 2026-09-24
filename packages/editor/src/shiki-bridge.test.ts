import { describe, expect, test } from 'bun:test';
import type { languages } from 'monaco-editor/editor';
import { type BundledLanguage, type BundledTheme, getSingletonHighlighter } from 'shiki';
import { type MonacoLanguages, monacoTheme, PLAIN_TEXT, ShikiBridge, type ShikiTheme } from './shiki-bridge.ts';

type Provider = languages.TokensProvider;

interface Registration {
    readonly id: string;
    readonly provider: Provider;
    disposed: boolean;
}

/* Monaco's registry keeps one provider per language, and a disposal takes it out only while it is still the one in place. */
const fakeLanguages = (): MonacoLanguages & { registered: string[]; providers: Registration[]; current: Map<string, Registration> } => {
    const registered: string[] = [];
    const providers: Registration[] = [];
    const current = new Map<string, Registration>();
    return {
        registered,
        providers,
        current,
        register: ({ id }) => {
            registered.push(id);
        },
        setTokensProvider: (id, provider) => {
            const registration = { id, provider: provider as Provider, disposed: false };
            providers.push(registration);
            current.set(id, registration);
            return {
                dispose: () => {
                    registration.disposed = true;
                    if (current.get(id) === registration) {
                        current.delete(id);
                    }
                }
            };
        }
    };
};

const highlighter = await getSingletonHighlighter({ themes: ['github-light', 'github-dark'], langs: ['typescript'] });

// Shiki writes an opaque color with its alpha at times and Monaco without; both are the same paint.
const opaque = (color: string): string => {
    const lower = color.toLowerCase();
    return lower.length === 9 && lower.endsWith('ff') ? lower.slice(0, 7) : lower;
};

const LINE = 'export const answer: number = await compute("forty-two", 42);';

// The grammar compiles its patterns on first use, which on a slow runner outlasts the 500 ms a Monaco tokenizer gets per line.
highlighter.codeToTokensBase(LINE, { lang: 'typescript', theme: 'github-dark', tokenizeTimeLimit: 0 });

/* The color Monaco paints each character in, by the scope the provider hands it and the rules of the theme. */
const monacoColors = (provider: Provider, theme: ShikiTheme): string[] => {
    const { colors: chrome, rules } = monacoTheme(highlighter, theme);
    const foreground = chrome['editor.foreground']!.toLowerCase();
    const { tokens } = provider.tokenize(LINE, provider.getInitialState());
    const colors: string[] = [];
    tokens.forEach((token, index) => {
        const end = tokens[index + 1]?.startIndex ?? LINE.length;
        const rule = rules.find((candidate) => candidate.token === token.scopes);
        const color = rule?.foreground ? `#${rule.foreground}` : foreground;
        for (let i = token.startIndex; i < end; i++) {
            colors.push(opaque(color));
        }
    });
    return colors;
};

/* The color the file viewer paints each character in: Shiki's own tokens, under the same theme. */
const viewerColors = (theme: ShikiTheme, lang: BundledLanguage = 'typescript'): string[] => {
    const [line = []] = highlighter.codeToTokensBase(LINE, { lang, theme: theme as BundledTheme });
    return line.flatMap((token) => [...token.content].map(() => opaque(token.color ?? '')));
};

describe('ShikiBridge', () => {
    test('colors a line the way the viewer does, in either theme', async () => {
        const monaco = fakeLanguages();
        const bridge = new ShikiBridge(highlighter, monaco, 'github-dark');
        expect(await bridge.language('typescript')).toBe('typescript');
        expect(monaco.registered).toEqual(['typescript']);

        // Monaco's tokenizer first: Shiki keeps the theme it was last asked for.
        const dark = monacoColors(monaco.providers[0]!.provider, 'github-dark');
        expect(dark).toEqual(viewerColors('github-dark'));

        bridge.setTheme('github-light');
        expect(monaco.providers[0]!.disposed).toBe(true);
        const light = monacoColors(monaco.providers[1]!.provider, 'github-light');
        expect(light).toEqual(viewerColors('github-light'));
        expect(light).not.toEqual(dark);
    });

    test('keeps a Shiki provider in place for every language through a theme change', async () => {
        const monaco = fakeLanguages();
        const bridge = new ShikiBridge(highlighter, monaco, 'github-dark');
        await bridge.language('typescript');
        await bridge.language('tsx');

        bridge.setTheme('github-light');
        expect([...monaco.current.keys()].sort()).toEqual(['javascript', 'typescript']);
        expect(monaco.providers.filter((registration) => !registration.disposed)).toHaveLength(2);
    });

    test('colors in a theme that was not loaded when the grammar was', async () => {
        const monaco = fakeLanguages();
        const bridge = new ShikiBridge(highlighter, monaco, 'github-light');
        await bridge.language('typescript');
        await highlighter.loadTheme('nord');

        bridge.setTheme('nord');
        const nord = monacoColors(monaco.providers[1]!.provider, 'nord');
        expect(nord).toEqual(viewerColors('nord'));
        expect(nord).not.toEqual(viewerColors('github-light'));
    });

    test('loads a grammar once however often it is asked for', async () => {
        const monaco = fakeLanguages();
        const bridge = new ShikiBridge(highlighter, monaco, 'github-light');
        const [first, second] = await Promise.all([bridge.language('rust'), bridge.language('rust')]);
        expect([first, second]).toEqual(['rust', 'rust']);
        expect(monaco.registered).toEqual(['rust']);
        expect(monaco.providers).toHaveLength(1);
    });

    test('draws TSX, JSX and JavaScript as one Monaco language in the TSX grammar, apart from TypeScript', async () => {
        const monaco = fakeLanguages();
        const bridge = new ShikiBridge(highlighter, monaco, 'github-dark');
        const ids = await Promise.all(['tsx', 'jsx', 'javascript', 'typescript'].map((id) => bridge.language(id)));
        expect(ids).toEqual(['javascript', 'javascript', 'javascript', 'typescript']);
        expect(monaco.registered).toEqual(['javascript', 'typescript']);
        expect(monacoColors(monaco.current.get('javascript')!.provider, 'github-dark')).toEqual(viewerColors('github-dark', 'tsx'));
    });

    test('keeps a generic arrow function in a TypeScript file from reading as a tag', async () => {
        const monaco = fakeLanguages();
        await new ShikiBridge(highlighter, monaco, 'github-dark').language('typescript');
        const provider = monaco.current.get('typescript')!.provider;
        const next = "const after = 'text';";
        const generic = provider.tokenize('const pick = <T>(items: T[]): T => items[0];', provider.getInitialState());
        expect(provider.tokenize(next, generic.endState).tokens).toEqual(provider.tokenize(next, provider.getInitialState()).tokens);
    });

    test('keeps an alias as the id the file asked for', async () => {
        const monaco = fakeLanguages();
        expect(await new ShikiBridge(highlighter, monaco, 'github-light').language('ts')).toBe('ts');
        expect(monaco.registered).toEqual(['ts']);
    });

    test('falls back to plain text for no language, an unknown one and the plain text ids of Shiki', async () => {
        const monaco = fakeLanguages();
        const bridge = new ShikiBridge(highlighter, monaco, 'github-light');
        expect(await bridge.language(undefined)).toBe(PLAIN_TEXT);
        expect(await bridge.language('not-a-language')).toBe(PLAIN_TEXT);
        expect(await bridge.language('text')).toBe(PLAIN_TEXT);
        expect(monaco.registered).toEqual([]);
    });
});
