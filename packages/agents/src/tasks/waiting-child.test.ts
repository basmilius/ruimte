import { expect, test } from 'bun:test';
import type { ChatQuestionItem } from '@ruimte/agent-contracts';
import { waitingTexts } from './waiting-child.ts';

test('a long question in a waiting note is cut between two characters', () => {
    // The emoji straddles the 199th unit, where the note cuts to make room for the ellipsis.
    const question = `${'q'.repeat(198)}😀 and the rest of it`;
    const item: ChatQuestionItem = {
        id: 'question-r1',
        kind: 'question',
        createdAt: 1,
        turnId: null,
        requestId: 'r1',
        questions: [{ id: 'q1', header: 'Choice', question, choices: [], multiSelect: false }],
        answers: null,
        state: 'pending'
    };
    const { note } = waitingTexts({ id: 'child', title: 'Child' }, item, { app: 'Ruimte', cli: 'ruimte-context' });
    expect(note.split('\n')[0]).toBe(`Child (node child) waits for an answer to ${JSON.stringify(`${'q'.repeat(198)}…`)}`);
});
