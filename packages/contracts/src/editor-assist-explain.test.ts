import { describe, expect, test } from 'bun:test';
import { explainPrompt } from './editor-assist-explain.ts';
import { boundLines } from './editor-assist-text.ts';

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
