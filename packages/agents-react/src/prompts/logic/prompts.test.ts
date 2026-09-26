import { describe, expect, test } from 'bun:test';
import { PROMPT_SAMPLES } from './prompts.fixtures';
import { answerValue, emptyPromptDraft, nextPrompt, pickPromptChoice, promptAnswers, questionAnswer } from './prompts';
import { ChatItemSchema } from '@ruimte/agent-contracts';

describe('prompt presentation', () => {
    test('a blocking request precedes an optional question, without replacing an active request', () => {
        const items = PROMPT_SAMPLES.at(-1)!.items;
        expect(nextPrompt(items, null)?.kind).toBe('approval');
        expect(nextPrompt(items, items[0]!.requestId)?.requestId).toBe(items[0]!.requestId);
        expect(nextPrompt([], items[0]!.requestId)).toBeNull();
    });
    test('custom text does not silently override a subsequently selected option', () => {
        const item = PROMPT_SAMPLES[3]!.items[0]!;
        if (item.kind !== 'question') {
            throw new Error('Expected question');
        }
        const question = item.questions[0]!;
        const picked = pickPromptChoice({ text: 'Earlier text', custom: true, choices: [] }, question, 'All three');
        expect(answerValue(picked)).toBe('All three');
        expect(answerValue({ ...picked, custom: true })).toBe('Earlier text');
    });
    test('answers survive moving backwards, and a request needs every answer before submission', () => {
        const item = PROMPT_SAMPLES[6]!.items[0]!;
        if (item.kind !== 'question') {
            throw new Error('Expected question');
        }
        const draft = emptyPromptDraft();
        expect(promptAnswers(item, draft)).toBeNull();
        const [first, second, third] = item.questions;
        draft.answers[first!.id] = { choices: ['All three'], custom: false, text: '' };
        draft.answers[second!.id] = { choices: ['Type check', 'Unit tests'], custom: false, text: '' };
        draft.answers[third!.id] = { choices: [], custom: true, text: '  Keep the draft  ' };
        draft.index = 2;
        expect(promptAnswers(item, draft)).toEqual({ endpoints: 'All three', checks: 'Type check, Unit tests', notes: 'Keep the draft' });
        draft.index = 0;
        expect(questionAnswer(draft, first!).choices).toEqual(['All three']);
        expect(questionAnswer(draft, third!).text).toBe('  Keep the draft  ');
    });
    test('multi-select labels containing commas stay individual choices', () => {
        const question = { id: 'q', header: '', question: '?', multiSelect: true, choices: [] };
        const first = pickPromptChoice({ text: '', custom: false, choices: [] }, question, 'Chat, files');
        const second = pickPromptChoice(first, question, 'Terminal');
        expect(pickPromptChoice(second, question, 'Chat, files').choices).toEqual(['Terminal']);
    });
    test('preview items exercise the actual wire shapes', () => {
        for (const sample of PROMPT_SAMPLES) {
            for (const item of sample.items) {
                expect(ChatItemSchema.safeParse(item).success).toBe(true);
            }
        }
    });
});
