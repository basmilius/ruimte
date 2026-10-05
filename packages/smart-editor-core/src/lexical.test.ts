import { describe, expect, it } from 'bun:test';
import { scanBrackets } from './brackets.ts';
import { DocumentModel } from './document.ts';
import { commentSyntax } from './languages.ts';
import { TypingContexts } from './typing-context.ts';

function contextAt(text: string, language: string): ReturnType<TypingContexts['at']> {
    const model = new DocumentModel(text);
    const contexts = new TypingContexts((line) => model.getLine(line));
    const { line, column } = model.positionAt(text.length);
    return contexts.at(line, column, language);
}

function typeAtEnd(text: string, character: string, language: string): string {
    const model = new DocumentModel(text);
    model.setSelections([{ anchor: text.length, head: text.length }]);
    model.typeText(character, { language });
    return model.getText();
}

describe('comment syntax by language', () => {
    it('keeps a slash and a star in a YAML value from opening a block comment for the rest of the file', () => {
        const text = 'x: a/*\ny: [1,\n';
        expect(contextAt(text, 'yaml').mode).toBe('code');
        expect(contextAt(text, 'yaml').bracket?.close).toBe(']');
        expect(typeAtEnd(text, '(', 'yaml')).toBe('x: a/*\ny: [1,\n()');
    });

    it('continues pairing and Enter after the same line in every language that has no block comments', () => {
        for (const language of ['yaml', 'shellscript', 'dockerfile', 'toml', 'ruby', 'python', 'perl', 'r', 'make', 'properties']) {
            expect(contextAt('x = a/*\n', language).mode).toBe('code');
        }
    });

    it('reads a hash as a comment in shell only at the start of a word', () => {
        expect(contextAt('# note ', 'shellscript').mode).toBe('line-comment');
        expect(typeAtEnd('# note ', "'", 'shellscript')).toBe("# note '");
        expect(contextAt('echo $# ', 'shellscript').mode).toBe('code');
        expect(contextAt('echo ${#list[@]} ', 'bash').mode).toBe('code');
        expect(contextAt('echo a #', 'bash').mode).toBe('line-comment');
        expect(contextAt('a: b#c', 'yaml').mode).toBe('code');
        expect(contextAt('a: b #c', 'yaml').mode).toBe('line-comment');
    });

    it('reads a hash as a comment anywhere in Python, Ruby and TOML', () => {
        for (const language of ['python', 'ruby', 'toml']) {
            expect(contextAt('x = 1#', language).mode).toBe('line-comment');
        }
    });

    it('reads a double dash as a comment in SQL and Lua only', () => {
        expect(contextAt('select 1 -- note ', 'sql').mode).toBe('line-comment');
        expect(contextAt('select 1 /* note ', 'sql').mode).toBe('block-comment');
        expect(contextAt('x = 1 -- note ', 'lua').mode).toBe('line-comment');
        expect(contextAt('i-- ', 'typescript').mode).toBe('code');
        expect(scanBrackets('select ( -- )\n', 'sql').unmatched.size).toBe(1);
    });

    it('reads slashes as comments in the C family and PHP, markup comments in HTML and none in CSS lines', () => {
        for (const language of ['typescript', 'java', 'go', 'rust', 'swift', 'kotlin', 'c', 'cpp', 'csharp', 'php', 'scss', 'less']) {
            expect(contextAt('x // note ', language).mode).toBe('line-comment');
            expect(contextAt('x /* note ', language).mode).toBe('block-comment');
        }
        expect(contextAt('# note ', 'php').mode).toBe('line-comment');
        expect(contextAt('<!-- note ', 'html').mode).toBe('html-comment');
        expect(contextAt('x // note ', 'html').mode).toBe('code');
        expect(contextAt('x // note ', 'css').mode).toBe('code');
        expect(contextAt('x /* note ', 'css').mode).toBe('block-comment');
        expect(contextAt('x /* note ', 'json').mode).toBe('code');
        expect(contextAt('x /* note ', 'jsonc').mode).toBe('block-comment');
    });

    it('gives a language nobody listed no comment syntax at all', () => {
        expect(contextAt('x // note ', 'brainfuck').mode).toBe('code');
        expect(contextAt('x /* note ', 'brainfuck').mode).toBe('code');
        expect(contextAt('x # note ', 'brainfuck').mode).toBe('code');
        expect(commentSyntax('brainfuck')).toEqual({ line: null, block: null });
    });
});
