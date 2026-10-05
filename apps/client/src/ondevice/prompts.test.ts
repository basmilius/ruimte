import { describe, expect, test } from 'bun:test';
import { boundLines, explainPrompt, ghostPrompt, namesPrompt } from './prompts';

describe('boundLines', () => {
    test('keeps what fits and says when the rest was left out', () => {
        expect(boundLines('a\nb', 10)).toBe('a\nb');
        expect(boundLines('aaaa\nbbbb\ncccc', 10)).toBe('aaaa\nbbbb\n[the rest is left out]');
    });
});

describe('explainPrompt', () => {
    test('asks for the language first and carries the signature, documentation and code', () => {
        const prompt = explainPrompt(
            { language: 'typescript', file: 'src/a.ts', signature: 'function f(): void', documentation: 'Does it.', source: 'function f() {}' },
            'Dutch'
        );
        expect(prompt.split('\n').slice(0, 2)).toEqual(['Explain this function.', 'Answer in Dutch.']);
        expect(prompt).toContain('Signature: function f(): void');
        expect(prompt).toContain('Documentation: Does it.');
        expect(prompt.endsWith('Code:\nfunction f() {}')).toBe(true);
    });

    test('says code for a selection, and bounds the source', () => {
        const prompt = explainPrompt({ language: 'php', file: 'a.php', source: 'x\n'.repeat(5000) }, 'English');
        expect(prompt.startsWith('Explain this code.')).toBe(true);
        expect(prompt.length).toBeLessThan(4400);
        expect(prompt).not.toContain('Signature');
    });
});

describe('namesPrompt', () => {
    test('lists the lines that use the name, at most eight and each trimmed', () => {
        const prompt = namesPrompt({
            language: 'typescript',
            name: 'hits',
            context: 'const hits = 1;',
            uses: Array.from({ length: 12 }, (_, index) => `  use(hits, ${index});`)
        });
        expect(prompt).toContain('Current name: hits');
        expect(prompt.split('\n').filter((line) => line.startsWith('use(hits'))).toHaveLength(8);
    });
});

describe('ghostPrompt', () => {
    test('keeps the lines nearest the caret on each side', () => {
        const before = Array.from({ length: 200 }, (_, index) => `before${index}`).join('\n');
        const after = Array.from({ length: 200 }, (_, index) => `after${index}`).join('\n');
        const prompt = ghostPrompt({ language: 'typescript', file: 'a.ts', before, after });
        expect(prompt).toContain('before199</before>');
        expect(prompt).not.toContain('before0\n');
        expect(prompt).toContain('<after>after0');
        expect(prompt).not.toContain('after100');
    });
});
