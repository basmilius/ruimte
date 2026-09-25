import { describe, expect, test } from 'bun:test';
import { join } from 'node:path';
import { createHighlighter } from 'shiki';
import { CODE_PALETTES, CODE_THEMES, type CodeRole } from './code-themes';

const HERE = new URL('.', import.meta.url).pathname;

const luminance = (hex: string): number => {
    const value = Number.parseInt(hex.slice(1, 7), 16);
    const [red, green, blue] = [(value >> 16) & 255, (value >> 8) & 255, value & 255].map((channel) => {
        const unit = channel / 255;
        return unit <= 0.03928 ? unit / 12.92 : ((unit + 0.055) / 1.055) ** 2.4;
    });
    return 0.2126 * (red ?? 0) + 0.7152 * (green ?? 0) + 0.0722 * (blue ?? 0);
};

const contrast = (first: string, second: string): number => {
    const [light, dark] = [luminance(first), luminance(second)].sort((a, b) => b - a);
    return ((light ?? 0) + 0.05) / ((dark ?? 0) + 0.05);
};

// WCAG AA for text, and 3:1 for the roles of a side that sit below it, so a tweak cannot drop them further.
const QUIET_ROLES: Readonly<Record<'light' | 'dark', readonly CodeRole[]>> = {
    light: ['comment', 'docComment', 'docTag', 'decorator'],
    dark: []
};
const floorOf = (mode: 'light' | 'dark', role: CodeRole): number => (QUIET_ROLES[mode].includes(role) ? 3 : 4.5);

const termBackground = async (mode: 'light' | 'dark'): Promise<string | undefined> => {
    const css = await Bun.file(join(HERE, '..', '..', 'styles.css')).text();
    return new RegExp(`\\[data-theme="${mode}"\\]\\s*\\{[^}]*?--term-bg:\\s*(#[0-9a-f]{6})`, 'i').exec(css)?.[1]?.toLowerCase();
};

describe('the colors of our code themes', () => {
    for (const theme of CODE_THEMES) {
        const palette = CODE_PALETTES[theme.type];

        test(`${theme.name} sits on the code background of its side`, async () => {
            expect(palette.background).toBe((await termBackground(theme.type)) ?? '');
            expect(theme.bg).toBe(palette.background);
        });

        test(`${theme.name} reads against that background in every role`, () => {
            const failing = Object.entries(palette.colors)
                .map(([role, color]) => ({ role, color, ratio: contrast(color, palette.background) }))
                .filter(({ role, ratio }) => ratio < floorOf(theme.type, role as CodeRole));
            expect(failing).toEqual([]);
        });

        test(`${theme.name} draws every rule in a color of its palette`, () => {
            const colors = new Set(Object.values(palette.colors));
            for (const entry of theme.tokenColors ?? []) {
                const foreground = entry.settings.foreground;
                if (foreground !== undefined) {
                    expect(colors.has(foreground)).toBe(true);
                }
            }
        });
    }
});

/* A line of code per language and the role a few words on it must come out in. */
const SAMPLES: readonly { lang: string; code: string; expected: Readonly<Record<string, CodeRole>> }[] = [
    {
        lang: 'tsx',
        code: [
            "import { useState } from 'react';",
            '/** @param start where to begin */',
            '@Component({ selector: 1 })',
            'export class Counter extends Base implements Api {}',
            'const LIMIT = 0x1f;',
            'const pattern = /^q+$/;',
            'export function Button(props: Props): JSX.Element {',
            '    const text = `${props.label}\\n`;',
            '    render(null);',
            '    return <div className="btn">{text}</div>;',
            '}'
        ].join('\n'),
        expected: {
            import: 'keyword',
            react: 'string',
            param: 'docTag',
            Component: 'decorator',
            Counter: 'type',
            Base: 'type',
            '0x1f': 'number',
            q: 'regex',
            Button: 'functionDeclaration',
            props: 'parameter',
            Props: 'type',
            label: 'property',
            '\\n': 'escape',
            render: 'functionCall',
            null: 'constant',
            div: 'tag',
            className: 'attribute',
            text: 'variable'
        }
    },
    {
        lang: 'python',
        code: ['@dataclass', 'class Point(Base):', '    def dist(self, other):', '        print(self.x, None)  # done'].join('\n'),
        expected: {
            dataclass: 'decorator',
            class: 'keyword',
            Point: 'type',
            dist: 'functionDeclaration',
            other: 'parameter',
            print: 'builtin',
            x: 'property',
            None: 'constant',
            done: 'comment'
        }
    },
    {
        lang: 'rust',
        code: ['#[derive(Debug)]', 'pub struct Point { x: i32 }', 'fn main() { let p = Point::new(3); println!("{}", p.x); }'].join('\n'),
        expected: { derive: 'decorator', struct: 'keyword', i32: 'type', main: 'functionDeclaration', new: 'functionCall', '3': 'number' }
    },
    {
        lang: 'go',
        code: ['package main', 'type Point struct { X int }', 'func (p *Point) Move(dx int) error { fmt.Println(p); return nil }'].join('\n'),
        expected: { func: 'keyword', Move: 'functionDeclaration', dx: 'parameter', int: 'type', Println: 'functionCall', X: 'property', nil: 'constant' }
    },
    {
        lang: 'php',
        code: ['<?php', 'final class User extends Model {', '    public function greet(string $name): string { return strlen($this->name); }', '}'].join('\n'),
        expected: { final: 'keyword', User: 'type', greet: 'functionDeclaration', strlen: 'functionCall', this: 'keyword' }
    },
    {
        lang: 'swift',
        code: ['struct ContentView: View {', '    @State private var count: Int = 0', '    func bump() -> Int { return count }', '}'].join('\n'),
        expected: { struct: 'keyword', ContentView: 'type', State: 'decorator', Int: 'type', '0': 'number', bump: 'functionDeclaration' }
    },
    {
        lang: 'json',
        code: '{ "name": "ruimte", "version": 1, "private": true }',
        expected: { name: 'property', ruimte: 'string', '1': 'number', true: 'constant' }
    },
    {
        lang: 'yaml',
        code: ['name: ruimte', 'enabled: true'].join('\n'),
        expected: { name: 'property', ruimte: 'string', true: 'constant' }
    },
    {
        lang: 'markdown',
        code: ['# Heading', 'Some `code` and a [link](https://ruimte.app).'].join('\n'),
        expected: { Heading: 'heading', code: 'inlineCode', link: 'link', 'https://ruimte.app': 'link' }
    },
    {
        lang: 'css',
        code: '.btn > div { color: #fff; margin: 4px; background: rgb(0 0 0); }',
        expected: { btn: 'attribute', div: 'tag', color: 'property', '4': 'number', px: 'number', rgb: 'functionCall' }
    },
    {
        lang: 'html',
        code: '<a href="/x">Link &amp; more</a>',
        expected: { a: 'tag', href: 'attribute', '/x': 'string', amp: 'entity' }
    },
    {
        lang: 'shellscript',
        code: 'export NAME="world"; grep --count foo',
        expected: { export: 'keyword', world: 'string', grep: 'functionCall', '-count': 'constant', foo: 'variable' }
    },
    {
        lang: 'diff',
        code: ['--- a/x.ts', '+++ b/x.ts', '@@ -1 +1 @@', '-removed', '+added'].join('\n'),
        expected: { removed: 'deleted', added: 'inserted' }
    }
];

describe('the scopes our code themes cover', () => {
    const loading = createHighlighter({ themes: [...CODE_THEMES], langs: SAMPLES.map((sample) => sample.lang) });

    for (const theme of CODE_THEMES) {
        const palette = CODE_PALETTES[theme.type];
        for (const { lang, code, expected } of SAMPLES) {
            test(`${theme.name} colors ${lang}`, async () => {
                const highlighter = await loading;
                // Shiki joins neighbors of one color into a token and a grammar may split a word, so a word is looked up both ways.
                // The explanation tokenizes each line twice under a 500 ms limit, and a loaded CI machine cut the first pass short.
                const pieces = highlighter
                    .codeToTokens(code, { lang: lang as never, theme: theme.name, includeExplanation: true, tokenizeTimeLimit: 0 })
                    .tokens.flat()
                    .flatMap((token) =>
                        [token.content, ...(token.explanation ?? []).map((piece) => piece.content)].map((text) => ({
                            text: text.trim(),
                            color: token.color?.toLowerCase()
                        }))
                    );
                const drawn = Object.fromEntries(Object.keys(expected).map((text) => [text, pieces.find((piece) => piece.text === text)?.color]));
                const wanted = Object.fromEntries(Object.entries(expected).map(([text, role]) => [text, palette.colors[role]]));
                expect(drawn).toEqual(wanted);
            });
        }
    }
});
