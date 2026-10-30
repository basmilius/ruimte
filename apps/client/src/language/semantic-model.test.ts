import { describe, expect, test } from 'bun:test';
import { shikiScopeColors } from '@adecore/editor';
import { scopesOf } from '@adecore/editor-react/models';
import { createHighlighter } from 'shiki';
import { CODE_PALETTES, CODE_THEMES, type CodeRole } from '@/shell/panels/code-themes';

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
