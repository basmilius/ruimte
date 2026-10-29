import { describe, expect, test } from 'bun:test';
import type { AgentRequest } from '@adecore/agent-contracts/agent';
import type { ChatRequestSummary } from '@adecore/agent-contracts/chat';
import { chatWaitAsk, pushWaitText, terminalWaitAsk } from './wait-ask.ts';

function terminalRequest(fields: Partial<AgentRequest>): AgentRequest {
    return { id: 'request', source: '', kind: 'approval', toolName: 'Bash', title: null, text: '', createdAt: 1, ...fields };
}

function chatApproval(approval: Partial<NonNullable<ChatRequestSummary['approval']>>): ChatRequestSummary {
    return {
        requestId: 'request',
        itemId: 'item',
        kind: 'approval',
        createdAt: 1,
        approval: { toolName: 'Bash', subject: '', description: null, canAllowAlways: false, ...approval }
    };
}

describe('terminalWaitAsk', () => {
    test('a shell call names the first line of its command', () => {
        expect(terminalWaitAsk([terminalRequest({ text: 'bun test \\\n  --filter push' })])).toEqual({
            kind: 'command',
            tool: 'Bash',
            detail: 'bun test \\',
            more: 0
        });
    });

    test('an edit names the file from its input', () => {
        const ask = terminalWaitAsk([terminalRequest({ toolName: 'Edit', text: JSON.stringify({ file_path: '/repo/src/push/service.ts' }) })]);

        expect(ask).toEqual({ kind: 'edit', tool: 'Edit', detail: 'service.ts', more: 0 });
    });

    test('an edit whose input was cut short names its title instead', () => {
        const ask = terminalWaitAsk([terminalRequest({ toolName: 'Write', title: 'Write the changelog', text: '{"file_path": "/repo/CHANG' })]);

        expect(ask?.detail).toBe('Write the changelog');
    });

    test('another tool names its title, or nothing', () => {
        expect(terminalWaitAsk([terminalRequest({ toolName: 'WebFetch', title: 'Read the docs', text: '{}' })])).toEqual({
            kind: 'tool',
            tool: 'WebFetch',
            detail: 'Read the docs',
            more: 0
        });
        expect(terminalWaitAsk([terminalRequest({ toolName: 'WebFetch', text: '{}' })])?.detail).toBeNull();
    });

    test('a question names its first question, not its options', () => {
        const ask = terminalWaitAsk([terminalRequest({ kind: 'question', toolName: 'AskUserQuestion', text: 'Which database?\n• Postgres\n• SQLite' })]);

        expect(ask).toEqual({ kind: 'question', tool: 'AskUserQuestion', detail: 'Which database?', more: 0 });
    });

    test('the oldest request speaks and counts the others', () => {
        const ask = terminalWaitAsk([terminalRequest({ text: 'ls' }), terminalRequest({ kind: 'question', text: 'Why?' }), terminalRequest({ text: 'pwd' })]);

        expect(ask?.detail).toBe('ls');
        expect(ask?.more).toBe(2);
    });

    test('a long line is cut to one notification line', () => {
        const detail = terminalWaitAsk([terminalRequest({ text: `echo ${'x'.repeat(300)}` })])?.detail ?? '';

        expect(detail.length).toBe(120);
        expect(detail.endsWith('…')).toBe(true);
    });

    test("an edited file's name is cut to one line too", () => {
        const edit = (path: string) => terminalWaitAsk([terminalRequest({ toolName: 'Write', text: JSON.stringify({ file_path: path }) })])?.detail ?? '';

        expect(edit(`/repo/${'x'.repeat(200)}.ts`).length).toBe(120);
        expect(edit('/repo/first\nsecond.ts')).toBe('first');
    });

    test('no request says nothing', () => {
        expect(terminalWaitAsk(undefined)).toBeNull();
        expect(terminalWaitAsk([])).toBeNull();
    });
});

describe('chatWaitAsk', () => {
    test('an approval with a command names the command', () => {
        expect(chatWaitAsk([chatApproval({ toolName: 'exec', command: 'bun run check', subject: 'bun run check' })])).toEqual({
            kind: 'command',
            tool: 'exec',
            detail: 'bun run check',
            more: 0
        });
    });

    test('an approval with a path names the file', () => {
        expect(chatWaitAsk([chatApproval({ toolName: 'Edit', path: 'apps/server/src/push/service.ts' })])?.detail).toBe('service.ts');
    });

    test('another approval names its subject', () => {
        expect(chatWaitAsk([chatApproval({ toolName: 'WebFetch', subject: 'docs.anthropic.com' })])).toEqual({
            kind: 'tool',
            tool: 'WebFetch',
            detail: 'docs.anthropic.com',
            more: 0
        });
    });

    test('a question names its first question', () => {
        const question: ChatRequestSummary = {
            requestId: 'request',
            itemId: 'item',
            kind: 'question',
            createdAt: 1,
            question: { questions: [{ id: 'q', header: 'Database', question: 'Which database should the tests use?', choices: [], multiSelect: false }] }
        };

        expect(chatWaitAsk([question, chatApproval({})])).toEqual({
            kind: 'question',
            tool: 'AskUserQuestion',
            detail: 'Which database should the tests use?',
            more: 1
        });
    });
});

describe('pushWaitText', () => {
    test('names the kind and the tool, never the detail', () => {
        expect(pushWaitText({ kind: 'command', tool: 'Bash', detail: 'export TOKEN=secret', more: 0 })).toBe('Wants to run a command');
        expect(pushWaitText({ kind: 'edit', tool: 'Edit', detail: 'service.ts', more: 0 })).toBe('Wants to edit a file');
        expect(pushWaitText({ kind: 'tool', tool: 'WebFetch', detail: 'docs', more: 0 })).toBe('Wants to use WebFetch');
        expect(pushWaitText({ kind: 'question', tool: 'AskUserQuestion', detail: 'Why?', more: 2 })).toBe('Asks a question, and 2 more');
    });
});
