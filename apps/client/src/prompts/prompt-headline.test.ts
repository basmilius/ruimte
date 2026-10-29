import { describe, expect, test } from 'bun:test';
import type { ChatApprovalItem, ChatQuestionItem } from '@ruimte/contracts';
import { PROMPT_SAMPLES } from '@adecore/agents-react/testing';
import type { PromptSubject } from '@adecore/agents-react/prompts';
import { promptHeadline } from '@/prompts/prompt-headline';
import { computerPrompt, waitingPrompt } from '@/prompts/ruimte-prompts';

function sample(label: string): ChatApprovalItem | ChatQuestionItem {
    return PROMPT_SAMPLES.find((entry) => entry.label === label)!.items[0] as ChatApprovalItem | ChatQuestionItem;
}

function chat(label: string): PromptSubject {
    return { kind: 'chat', nodeId: 'chat-1', item: sample(label) };
}

describe('the headline of a prompt', () => {
    test('is the first question of a question card', () => {
        expect(promptHeadline(chat('Question · Single choice'))).toBe('Which endpoints should share the backoff?');
        expect(promptHeadline(chat('Question · Three questions'))).toBe('Which endpoints should share the backoff?');
    });

    test('is the tool and what it acts on for an approval', () => {
        expect(promptHeadline(chat('Permission · Command'))).toBe('Bash bun run check && bun test');
        expect(promptHeadline(chat('Permission · File edit'))).toBe('Edit src/transport/pool.ts');
    });

    test("is the heading of one of Ruimte's own cards", () => {
        const computer = computerPrompt('chat-1', {
            requestId: 'computer-1',
            nodeId: 'chat-1',
            surface: 'chat',
            nodeTitle: 'Docs',
            projectId: 'p1',
            projectName: 'Ruimte',
            app: { name: 'TextEdit', bundleId: 'com.example.textedit' },
            command: 'state',
            createdAt: 7,
            expiresAt: 600_007
        });

        expect(promptHeadline({ kind: 'host', nodeId: 'chat-1', prompt: computer })).toBe('Let an agent use TextEdit?');
        expect(promptHeadline({ kind: 'host', nodeId: 'terminal-1', prompt: waitingPrompt('terminal-1', 5) })).toBe('Waiting for you in its terminal');
    });
});
