import { MAX_OPENED_PER_CALLER, MAX_PROMPT_LENGTH, MAX_TITLE_LENGTH, type ActionInput } from '../index.ts';
import { without, type WriteCases } from './case.ts';

// What every actor of agent.start may give; the fields only an agent gives are below, in restricted.
const start: ActionInput<'agent.start'> = {
    provider: 'claude',
    terminal: false,
    prompt: 'Review the catalog tests',
    promptFile: null,
    cwd: null,
    reads: null,
    viewId: null,
    beside: null,
    group: null,
    title: 'Reviewer',
    task: null,
    model: null,
    mode: 'auto-accept-edits',
    worktree: null,
    branch: null,
    requestId: 'start-1',
    base: null,
    machine: null,
    effort: 'high',
    account: null
};
const AGENT_ONLY = ['agent'] as const;
const DAEMON_FIELD = ['person', 'agent'] as const;
const role = { title: 'Tester', prompt: 'Write the tests', provider: 'codex', model: null, terminal: false, effort: 'medium' } as const;
const team: ActionInput<'team.start'> = { label: 'Release', roles: [role], cwd: null, reads: null, viewId: null, mode: null, worktree: false, task: true };

export const cases: WriteCases = {
    'extension.voiceRun': {
        actors: ['person', 'voice'],
        input: { id: 'acme.builds/status', input: '{}' },
        refused: { 'no action': { input: '{}' } }
    },
    'tool.run': {
        actors: ['person', 'agent'],
        input: { id: 'acme.builds/failing-log', input: '{}' },
        refused: { 'no tool': { input: '{}' } }
    },
    'agent.answer': {
        actors: ['person', 'agent'],
        input: { nodeId: 'chat-2', requestId: 'request-1', answer: 'The second one', answers: null },
        refused: {
            'an empty request': { nodeId: 'chat-2', requestId: '', answer: 'Yes', answers: null },
            'no answers at all': { nodeId: 'chat-2', requestId: 'request-1', answer: 'Yes' },
            'an answer that is no text': { nodeId: 'chat-2', requestId: 'request-1', answer: null, answers: { q1: 2 } }
        }
    },
    'task.create': {
        actors: ['person', 'agent'],
        input: { nodeId: 'chat-2', prompt: 'Run the integration suite', title: null },
        refused: {
            'no prompt at all': { nodeId: 'chat-2', title: null },
            'a title past the title limit': { nodeId: 'chat-2', prompt: 'Run', title: 'x'.repeat(MAX_TITLE_LENGTH + 1) }
        },
        restricted: {
            promptFile: { value: 'prompts/integration.md', actors: ['agent'] }
        }
    },
    'task.complete': {
        actors: ['agent'],
        input: { result: 'Every write is covered' },
        refused: { 'no result at all': {}, 'a result that is no text': { result: 42 } },
        restricted: {
            resultFile: { value: 'reports/result.md', actors: ['agent'] }
        }
    },
    'agent.start': {
        actors: ['person', 'voice', 'agent'],
        input: start,
        refused: {
            'a CLI that is no identifier': { ...start, provider: 'Cursor CLI' },
            'a mode it has not': { ...start, mode: 'root' },
            'a request id with a space': { ...start, requestId: 'start 1' },
            'a title past the title limit': { ...start, title: 'x'.repeat(MAX_TITLE_LENGTH + 1) },
            'no answer to terminal': without(start, 'terminal'),
            'a blank effort': { ...start, effort: ' ' }
        },
        restricted: {
            promptFile: { value: 'prompts/review.md', actors: AGENT_ONLY },
            cwd: { value: 'packages/actions', actors: DAEMON_FIELD },
            reads: { value: ['note-1'], actors: DAEMON_FIELD },
            group: { value: 'group-1', actors: DAEMON_FIELD },
            task: { value: 'Review', actors: DAEMON_FIELD },
            worktree: { value: true, actors: DAEMON_FIELD },
            branch: { value: 'review', actors: DAEMON_FIELD },
            base: { value: 'main', actors: DAEMON_FIELD },
            machine: { value: 'machine-b', actors: DAEMON_FIELD },
            account: { value: 'codex_work', actors: DAEMON_FIELD }
        }
    },
    'team.start': {
        actors: ['person', 'agent'],
        input: team,
        refused: {
            'nobody in it': { ...team, roles: [] },
            'more roles than one caller may open': { ...team, roles: Array.from({ length: MAX_OPENED_PER_CALLER + 1 }, () => role) },
            'a prompt past what a shell takes': { ...team, roles: [{ ...role, prompt: 'x'.repeat(MAX_PROMPT_LENGTH + 1) }] },
            'a blank label': { ...team, label: ' ' },
            'a role with a blank effort': { ...team, roles: [{ ...role, effort: ' ' }] }
        }
    }
};
