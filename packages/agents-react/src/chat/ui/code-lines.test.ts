import { describe, expect, test } from 'bun:test';
import { createHighlighter } from 'shiki/bundle/web';
import { IncrementalLines, type CodeToken, type Tokenize } from './code-lines';

/* A tokenizer that turns every line into one token and records what it was asked to read. */
const recording = () => {
    const calls: string[] = [];
    const tokenize: Tokenize<number> = (code, state) => {
        calls.push(code);
        const lines = code.split('\n').map((line) => [{ content: line }]);
        return { lines, state: (state ?? 0) + lines.length };
    };
    return { calls, tokenize };
};

const contents = (lines: CodeToken[][]): string[] => lines.map((line) => line.map((token) => token.content).join(''));

describe('IncrementalLines', () => {
    test('a growing block tokenizes only the lines that ended since the last update and the one being written', () => {
        const { calls, tokenize } = recording();
        const lines = new IncrementalLines(tokenize);

        expect(contents(lines.update('const a', false))).toEqual(['const a']);
        expect(contents(lines.update('const a = 1;\nconst b', false))).toEqual(['const a = 1;', 'const b']);
        expect(contents(lines.update('const a = 1;\nconst b = 2;\nlet c', false))).toEqual(['const a = 1;', 'const b = 2;', 'let c']);

        expect(calls).toEqual(['const a', 'const a = 1;', 'const b', 'const b = 2;', 'let c']);
    });

    test('the work per update stays the same however long the block already is', () => {
        const { calls, tokenize } = recording();
        const lines = new IncrementalLines(tokenize);
        let code = '';
        for (let i = 0; i < 200; i++) {
            code += `line ${i}\n`;
            lines.update(`${code}next`, false);
        }
        const last = calls.slice(-2);
        expect(last).toEqual(['line 199', 'next']);
        expect(lines.update(`${code}next`, false)).toHaveLength(201);
    });

    test('closing keeps the lines and tokenizes the last one once more', () => {
        const { calls, tokenize } = recording();
        const lines = new IncrementalLines(tokenize);
        lines.update('a\nb', false);
        calls.length = 0;
        expect(contents(lines.update('a\nb', true))).toEqual(['a', 'b']);
        expect(calls).toEqual(['b']);
    });

    test('a text that is not a continuation starts over', () => {
        const { calls, tokenize } = recording();
        const lines = new IncrementalLines(tokenize);
        lines.update('one\ntwo\n', false);
        calls.length = 0;
        expect(contents(lines.update('other\n', false))).toEqual(['other', '']);
        expect(calls).toEqual(['other', '']);
    });

    test('a carriage return tokenizes the whole block every time', () => {
        const { calls, tokenize } = recording();
        const lines = new IncrementalLines(tokenize);
        lines.update('a\r\nb', false);
        expect(calls).toEqual(['a\r\nb']);
    });

    test('with shiki, a comment and a template string across increments color the same as the whole block at once', async () => {
        const highlighter = await createHighlighter({ themes: ['github-dark'], langs: ['ts'] });
        const options = { lang: 'ts', theme: 'github-dark' } as const;
        const tokenize: Tokenize<ReturnType<typeof highlighter.getLastGrammarState>> = (code, state) => {
            const result = highlighter.codeToTokens(code, { ...options, ...(state ? { grammarState: state } : {}) });
            return { lines: result.tokens, state: result.grammarState };
        };
        const code = 'const a = 1;\n/* opens\nstill a comment */\nconst s = `x\n${a}`;\nlet b = 2;';
        const lines = new IncrementalLines(tokenize);
        let streamed: CodeToken[][] = [];
        for (let i = 1; i <= code.length; i++) {
            streamed = lines.update(code.slice(0, i), i === code.length);
        }
        const colors = (tokens: CodeToken[][]) => tokens.map((line) => line.map((token) => [token.content, token.color]));
        expect(colors(streamed)).toEqual(colors(highlighter.codeToTokens(code, options).tokens));
    });
});
