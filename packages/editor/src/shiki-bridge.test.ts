import { describe, expect, test } from 'bun:test';
import type { languages } from 'monaco-editor/editor';
import { getSingletonHighlighter } from 'shiki';
import { type MonacoLanguages, monacoTheme, PLAIN_TEXT, ShikiBridge, type ShikiTheme } from './shiki-bridge.ts';

type Provider = languages.TokensProvider;

interface Registration {
    readonly id: string;
    readonly provider: Provider;
    disposed: boolean;
}

const fakeLanguages = (): MonacoLanguages & { registered: string[]; providers: Registration[] } => {
    const registered: string[] = [];
    const providers: Registration[] = [];
    return {
        registered,
        providers,
        register: ({ id }) => {
            registered.push(id);
        },
        setTokensProvider: (id, provider) => {
            const registration = { id, provider: provider as Provider, disposed: false };
            providers.push(registration);
            return {
                dispose: () => {
                    registration.disposed = true;
                }
            };
        }
    };
};

const highlighter = await getSingletonHighlighter({ themes: ['github-light', 'github-dark'] });

const LINE = 'export const answer: number = await compute("forty-two", 42);';

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
            colors.push(color.toLowerCase());
        }
    });
    return colors;
};

/* The color the file viewer paints each character in: Shiki's own tokens, under the same theme. */
const viewerColors = (theme: ShikiTheme): string[] => {
    const [line = []] = highlighter.codeToTokensBase(LINE, { lang: 'typescript', theme });
    return line.flatMap((token) => [...token.content].map(() => (token.color ?? '').toLowerCase()));
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

    test('loads a grammar once however often it is asked for', async () => {
        const monaco = fakeLanguages();
        const bridge = new ShikiBridge(highlighter, monaco, 'github-light');
        const [first, second] = await Promise.all([bridge.language('rust'), bridge.language('rust')]);
        expect([first, second]).toEqual(['rust', 'rust']);
        expect(monaco.registered).toEqual(['rust']);
        expect(monaco.providers).toHaveLength(1);
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
