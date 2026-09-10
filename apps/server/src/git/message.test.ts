import { describe, expect, test } from 'bun:test';
import { buildMessagePrompt, parseSuggestion } from './message.ts';

describe('the prompt', () => {
    test('it carries the files and the patch, and asks for JSON only', () => {
        const prompt = buildMessagePrompt('M\tsrc/a.ts', 'diff --git a/src/a.ts b/src/a.ts\n+one\n');

        expect(prompt).toContain('{"subject": "...", "body": "..."}');
        expect(prompt).toContain('M\tsrc/a.ts');
        expect(prompt).toContain('+one');
        expect(prompt).toContain('imperative');
    });

    test('an empty side is named instead of left blank, so the model does not fill it in', () => {
        const prompt = buildMessagePrompt('', '');
        expect(prompt).toContain('(none reported)');
        expect(prompt).toContain('(empty)');
    });
});

describe('the answer', () => {
    test('the JSON object is taken out of whatever was printed around it', () => {
        const output = 'Reading the patch.\n{"subject": "feat: add a thing", "body": "Because it was missing.\\n"}\nDone.';
        expect(parseSuggestion(output)).toEqual({ subject: 'feat: add a thing', body: 'Because it was missing.' });
    });

    test('a body the model left out is an empty one', () => {
        expect(parseSuggestion('{"subject": "fix: typo"}')).toEqual({ subject: 'fix: typo', body: '' });
    });

    test('a plain line is the subject, and nothing at all is nothing', () => {
        expect(parseSuggestion('chore: bump deps\n')).toEqual({ subject: 'chore: bump deps', body: '' });
        expect(parseSuggestion('   \n\n')).toBeNull();
    });
});
