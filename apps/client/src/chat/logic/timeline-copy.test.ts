import { describe, expect, test } from 'bun:test';
import type { ChatAssistantItem, ChatToolItem, ChatUserItem } from '@ruimte/contracts';
import type { TimelineRow } from '@/chat/logic/timeline';
import { markdownOf, messageTextOf, stripMarkdown } from '@/chat/logic/timeline-copy';

const user: ChatUserItem = { id: 'u1', kind: 'user', createdAt: 0, turnId: null, text: 'Fix the build' };

const assistant: ChatAssistantItem = { id: 'a1', kind: 'assistant', createdAt: 0, turnId: null, text: '## Done\n\nI fixed **the build**.', streaming: false };

const tool = (patch: Partial<ChatToolItem>): ChatToolItem => ({
    id: 't1',
    kind: 'tool',
    createdAt: 0,
    turnId: null,
    toolUseId: 'call-1',
    name: 'Bash',
    input: {},
    output: 'ok',
    state: 'done',
    parentToolUseId: null,
    ...patch
});

describe('stripMarkdown', () => {
    test('drops the marks and keeps what they marked', () => {
        expect(stripMarkdown('# Title\n\nA **bold** and *thin* word, `code` too.')).toBe('Title\n\nA bold and thin word, code too.');
        expect(stripMarkdown('See [the docs](https://bas.dev/docs).')).toBe('See the docs.');
        expect(stripMarkdown('> quoted\n> lines')).toBe('quoted\nlines');
        expect(stripMarkdown('```ts\nconst a = 1;\n```')).toBe('const a = 1;');
    });

    test('leaves an underscore alone, because identifiers are full of them', () => {
        expect(stripMarkdown('the field is `file_path` and the_other_one')).toBe('the field is file_path and the_other_one');
    });
});

describe('messageTextOf', () => {
    test('a question is its own text and an answer is its markdown as text', () => {
        expect(messageTextOf({ kind: 'user', id: 'r1', item: user })).toBe('Fix the build');
        expect(messageTextOf({ kind: 'assistant', id: 'r2', item: assistant })).toBe('Done\n\nI fixed the build.');
    });

    test('a tool call answers with its output, or with what it has so far', () => {
        expect(messageTextOf({ kind: 'work', id: 'r3', tool: tool({}) })).toBe('ok');
        const running = tool({ output: null, state: 'running', progress: { startedAt: 0, description: null, output: 'half' } });
        expect(messageTextOf({ kind: 'work-live', id: 'r4', tool: running })).toBe('half');
    });

    test('a group of calls hands over every output it has', () => {
        const row: TimelineRow = { kind: 'work-group', id: 'r5', tools: [tool({}), tool({ id: 't2', output: null })], summary: '2 calls', expanded: false };
        expect(messageTextOf(row)).toBe('ok');
    });

    test('a row that is a divider or a fold carries no message', () => {
        expect(messageTextOf({ kind: 'compaction', id: 'r6', preTokens: 10 })).toBeNull();
        expect(messageTextOf({ kind: 'working', id: 'r7', startedAt: 0 })).toBeNull();
    });
});

describe('markdownOf', () => {
    test('only an answer has a source to copy', () => {
        expect(markdownOf({ kind: 'assistant', id: 'r2', item: assistant })).toBe('## Done\n\nI fixed **the build**.');
        expect(markdownOf({ kind: 'user', id: 'r1', item: user })).toBeNull();
    });
});

describe('what a message copies', () => {
    test('carries the text alone and never the author the heading names', () => {
        expect(messageTextOf({ kind: 'user', id: user.id, item: user })).toBe('Fix the build');
        expect(messageTextOf({ kind: 'assistant', id: assistant.id, item: assistant })).toBe('Done\n\nI fixed the build.');
    });
});
