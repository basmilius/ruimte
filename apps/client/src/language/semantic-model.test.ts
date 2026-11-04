import { describe, expect, test } from 'bun:test';
import { shikiScopeColors } from '@adecore/editor';
import { decodeSemanticTokens, scopesOf } from '@adecore/editor-react/models';
import { createHighlighter } from 'shiki';
import { CODE_PALETTES, CODE_THEMES, type CodeRole } from '@/shell/panels/code-themes';

describe('the PHP server legend', () => {
    test("reads the PHP server's legend by name, with the five types of its SQL appended after its own", () => {
        const php = {
            tokenTypes: ['namespace', 'class', 'function', 'variable', 'property', 'keyword', 'comment', 'string', 'number', 'operator', 'type'],
            tokenModifiers: ['declaration', 'static']
        };
        // In a string of SQL: a keyword, a table, a column and a type, the ones the grammar leaves to its string color.
        const data = [0, 10, 6, 5, 0, 0, 7, 5, 1, 0, 0, 6, 5, 4, 0, 0, 6, 4, 10, 0];
        expect(decodeSemanticTokens({ data }, php)).toEqual([
            { line: 0, character: 10, length: 6, scopes: ['keyword'], within: 'string' },
            { line: 0, character: 17, length: 5, scopes: ['entity.name.type.class'] },
            { line: 0, character: 23, length: 5, scopes: ['variable.other.property'] },
            { line: 0, character: 29, length: 4, scopes: ['entity.name.type'] }
        ]);
    });
});

describe('the colors of what a language server classifies', () => {
    const cases: readonly { type: string; modifiers: readonly string[]; scoped?: boolean; role: CodeRole }[] = [
        { type: 'function', modifiers: ['declaration'], role: 'functionDeclaration' },
        { type: 'function', modifiers: [], role: 'call' },
        { type: 'method', modifiers: [], role: 'methodCall' },
        { type: 'method', modifiers: ['static'], role: 'staticCall' },
        { type: 'property', modifiers: ['static'], role: 'staticProperty' },
        { type: 'property', modifiers: [], role: 'property' },
        { type: 'typeParameter', modifiers: [], role: 'typeParameter' },
        { type: 'parameter', modifiers: [], role: 'parameter' },
        { type: 'class', modifiers: [], role: 'type' },
        { type: 'decorator', modifiers: [], role: 'decorator' },
        { type: 'variable', modifiers: ['defaultLibrary'], scoped: true, role: 'constant' }
    ];

    for (const theme of CODE_THEMES) {
        test(`${theme.name} draws each in the color of its role`, async () => {
            const colorsOf = await shikiScopeColors(() => createHighlighter({ themes: [theme], langs: [] }))(theme.name);
            const drawn = cases.map(({ type, modifiers, scoped }) => colorsOf?.(scopesOf(type, new Set(modifiers), scoped) ?? [])?.color);
            expect(drawn).toEqual(cases.map(({ role }) => CODE_PALETTES[theme.type].colors[role]));
        });
    }
});
