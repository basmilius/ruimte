import { expect, test } from 'bun:test';
import { RESULT_PREVIEW_BYTES, wakePrompt } from '@adecore/agents/coordination';
import type { ChatQuestionItem, Task } from '@ruimte/contracts';
import { TASK_WORDS } from './words.ts';

function task(id: string, overrides: Partial<Task> = {}): Task {
    return {
        id,
        projectId: 'project',
        parentId: 'chat-lead',
        childId: `chat-${id}`,
        title: `Title ${id}`,
        prompt: 'do it',
        status: 'done',
        result: { text: `result of ${id}`, source: 'turn', at: 1 },
        createdAt: 1,
        settledAt: 2,
        wake: 'pending',
        ...overrides
    };
}

function question(questions: ChatQuestionItem['questions']): ChatQuestionItem {
    return { id: 'question-r1', kind: 'question', createdAt: 1, turnId: null, requestId: 'r1', questions, answers: null, state: 'pending' };
}

test("a child's question is answered with agent_answer and its fields", () => {
    const one = question([{ id: 'q1', header: 'Pick', question: 'Which?', choices: [], multiSelect: true }]);
    const two = question([
        { id: 'q1', header: 'Pick', question: 'Which?', choices: [], multiSelect: false },
        { id: 'q2', header: 'Why', question: 'Why?', choices: [], multiSelect: false }
    ]);
    expect(TASK_WORDS.answerCall?.('chat-a', one)).toBe(
        'agent_answer with id "chat-a", request "r1" and answer "<a choice label as written, or your own words>", several labels in one answer separated by a comma'
    );
    expect(TASK_WORDS.answerCall?.('chat-a', two)).toBe(
        `agent_answer with id "chat-a", request "r1" and answers '{"q1":"...","q2":"..."}', one answer per question id`
    );
});

test('a cut result tells the parent in the tools of the MCP server where the rest is read', () => {
    const text = 'x'.repeat(RESULT_PREVIEW_BYTES + 1);
    const prompt = wakePrompt([task('a', { result: { text, source: 'done', at: 1 } })], 0, TASK_WORDS.restOf);
    expect(prompt).toEndWith(
        '\n\n[The result was cut at 8 KiB. context_read chat-a shows the rest once a line runs from that node into you; link_new to chat-a draws it.]'
    );
});
