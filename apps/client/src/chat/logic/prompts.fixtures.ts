import type { ChatQuestion, ChatQuestionItem, ChatApprovalItem } from '@ruimte/contracts';
import type { PendingPrompt } from './prompts';

const endpoints: ChatQuestion = {
    id: 'endpoints',
    header: 'Shared backoff',
    question: 'Which endpoints should share the backoff?',
    multiSelect: false,
    choices: [
        { label: 'All three', description: 'Chat, files and terminal' },
        { label: 'Only chat and files', description: 'Keep terminal retries separate' }
    ]
};
const checks: ChatQuestion = {
    id: 'checks',
    header: 'Validation',
    question: 'Which checks should run before the change is ready?',
    multiSelect: true,
    choices: [
        { label: 'Type check', description: 'Check all workspaces' },
        { label: 'Unit tests', description: 'Run the targeted tests' },
        { label: 'Build', description: 'Verify the production bundle' }
    ]
};
const notes: ChatQuestion = { id: 'notes', header: 'Instructions', question: 'What else should the agent keep in mind?', multiSelect: false, choices: [] };
const base = (id: string) => ({ id: `preview-${id}`, requestId: `preview-${id}`, createdAt: 0, turnId: null });
const question = (id: string, questions: ChatQuestion[], async = false): ChatQuestionItem => ({
    ...base(id),
    kind: 'question',
    questions,
    answers: null,
    state: 'pending',
    async
});
const approval = (long = false): ChatApprovalItem => ({
    ...base(long ? 'long' : 'edit'),
    kind: 'approval',
    toolUseId: null,
    toolName: 'Edit',
    description: 'Replace the reconnect loop with the shared backoff and export it for the three endpoints.',
    input: {
        file_path: 'src/transport/pool.ts',
        old_string: 'const retries = 10;',
        new_string:
            'const retries = 5;\nexport const backoff = createBackoff({ max: retries });' +
            (long ? '\n' + Array.from({ length: 90 }, (_, i) => `// Context line ${i + 1}`).join('\n') : '')
    },
    canAllowAlways: false,
    decision: 'pending'
});

// These never enter the chat store or the transport; the preview owns their lifetime.
export const PROMPT_SAMPLES: Array<{ label: string; items: PendingPrompt[] }> = [
    { label: 'Permission · File edit', items: [approval()] },
    {
        label: 'Permission · Command',
        items: [
            {
                ...base('command'),
                kind: 'approval',
                toolName: 'Bash',
                toolUseId: null,
                input: { command: 'bun run check && bun test', cwd: '/projects/ruimte' },
                description: "Run the project's validation checks before continuing.",
                canAllowAlways: true,
                allowAlways: { label: 'Allow for this session', description: 'Allow commands in this session until it ends.' },
                decision: 'pending'
            }
        ]
    },
    { label: 'Permission · Long diff', items: [approval(true)] },
    { label: 'Question · Single choice', items: [question('single', [endpoints])] },
    { label: 'Question · Multiple choices', items: [question('multiple', [checks])] },
    { label: 'Question · Written answer', items: [question('written', [notes])] },
    { label: 'Question · Three questions', items: [question('questions', [endpoints, checks, notes])] },
    { label: 'Question · Optional', items: [question('optional', [endpoints], true)] },
    { label: 'Several requests', items: [question('optional', [endpoints], true), approval(), question('single', [endpoints])] }
];
