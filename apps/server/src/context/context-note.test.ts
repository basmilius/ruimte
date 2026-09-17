import { describe, expect, test } from 'bun:test';
import type { ContextSource } from '@ruimte/contracts';
import { chatPrompt, contextChangeNote, contextHint, hookContext, verbsNote } from './context-note.ts';

const VERBS_NOTE = verbsNote({ depth: 0 });

const text: ContextSource = { id: 'text-1', kind: 'text', title: 'Sprint goals' };
const terminal: ContextSource = { id: 'term-1', kind: 'terminal', title: 'dev server' };
const chat: ContextSource = { id: 'chat-1', kind: 'chat', title: 'planner' };

describe('contextHint', () => {
    test('is silent without links and names each source with its kind', () => {
        expect(contextHint([])).toBeNull();
        expect(contextHint([text, terminal])).toBe(
            'Ruimte: linked context is available with ruimte-context (list, read <id>): "Sprint goals" (text), "dev server" (terminal).'
        );
    });

    test('caps the names and counts the rest', () => {
        const many = Array.from({ length: 8 }, (_, i): ContextSource => ({ id: `t${i}`, kind: 'text', title: `Note ${i}` }));
        const hint = contextHint(many);
        expect(hint).toContain('"Note 4" (text) and 3 more.');
        expect(hint).not.toContain('Note 5');
    });
});

describe('verbsNote', () => {
    test('offers team and agent at depth 0, only agent at depth 1 and neither below', () => {
        expect(VERBS_NOTE).toContain('`agent` for one, `team` for several in parallel');
        expect(VERBS_NOTE).toContain('end your turn instead of polling');
        const helper = verbsNote({ depth: 1 });
        expect(helper).toContain('opens a helper agent with `agent`');
        expect(helper).not.toContain('`team`');
        expect(helper).toContain('--task');
        const deepest = verbsNote({ depth: 2 });
        expect(deepest).not.toContain('`agent`');
        expect(deepest).not.toContain('--task');
        for (const note of [VERBS_NOTE, helper, deepest]) {
            expect(note).toContain('`ruimte-context help <verb>`');
            expect(note).toEndWith('never by id.');
            expect(note).not.toContain('  ');
        }
    });
});

describe('chatPrompt', () => {
    test('always names the verbs for its depth, and the links only when there are some', () => {
        expect(chatPrompt({ hasContext: false, depth: 0 })).toBe(VERBS_NOTE);
        expect(chatPrompt({ hasContext: false, depth: 2 })).toBe(verbsNote({ depth: 2 }));
        expect(chatPrompt({ hasContext: true, depth: 0 })).toStartWith(`${VERBS_NOTE} The person linked context to this chat`);
    });
});

describe('hookContext', () => {
    test('SessionStart always carries the verbs, a prompt only the links', () => {
        expect(hookContext('SessionStart', [])).toBe(VERBS_NOTE);
        expect(hookContext('SessionStart', [text])).toBe(`${VERBS_NOTE} ${contextHint([text])}`);
        expect(hookContext('UserPromptSubmit', [])).toBeNull();
        expect(hookContext('UserPromptSubmit', [text])).toBe(contextHint([text]));
    });

    test('a CLI whose launch line carried the verbs hears only its links and messages at a start', () => {
        const message = 'Ruimte: node term-2 ("builder") sent you a message: the build is green.';
        expect(hookContext('SessionStart', [], { verbs: false })).toBeNull();
        expect(hookContext('SessionStart', [text], { verbs: false, messages: [message] })).toBe(`${contextHint([text])} ${message}`);
        expect(hookContext('UserPromptSubmit', [text], { verbs: false })).toBe(contextHint([text]));
    });

    test('SessionStart names the verbs for the depth the agent sits at', () => {
        expect(hookContext('SessionStart', [], { depth: 2 })).toBe(verbsNote({ depth: 2 }));
    });

    test('a line drawn while the agent ran is named at its next prompt and not at a start', () => {
        const changed = contextChangeNote([], [terminal]);
        expect(hookContext('UserPromptSubmit', [terminal], { changed })).toBe(`${contextHint([terminal])} ${changed}`);
        // The start is handed the whole list, so the same note there would only say it twice.
        expect(hookContext('SessionStart', [terminal], { changed })).toBe(`${VERBS_NOTE} ${contextHint([terminal])}`);
        expect(hookContext('UserPromptSubmit', [terminal], { changed: null })).toBe(contextHint([terminal]));
    });

    test('a message from another node rides along with a prompt and with a start', () => {
        const message = 'Ruimte: node term-2 ("builder") sent you a message: the build is green.';
        expect(hookContext('UserPromptSubmit', [], { messages: [message] })).toBe(message);
        expect(hookContext('SessionStart', [], { messages: [message] })).toBe(`${VERBS_NOTE} ${message}`);
    });
});

describe('contextChangeNote', () => {
    test('nothing to say when the set is the same, also after a rename', () => {
        expect(contextChangeNote([], [])).toBeNull();
        expect(contextChangeNote([text, chat], [chat, text])).toBeNull();
        expect(contextChangeNote([text], [{ ...text, title: 'Renamed' }])).toBeNull();
    });

    test('names what was added and points at the CLI', () => {
        expect(contextChangeNote([text], [text, terminal])).toBe(
            'Ruimte: the linked context changed since your last turn. Added: "dev server" (terminal). Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item.'
        );
    });

    test('names what was removed, and says so when nothing is left', () => {
        expect(contextChangeNote([text, chat], [text])).toBe(
            'Ruimte: the linked context changed since your last turn. Removed: "planner" (chat). Run `ruimte-context` to list it and `ruimte-context read <id>` to read one item.'
        );
        expect(contextChangeNote([text], [])).toBe(
            'Ruimte: the linked context changed since your last turn. Removed: "Sprint goals" (text). Nothing is linked now.'
        );
    });

    test('reports both directions in one note', () => {
        const note = contextChangeNote([text, chat], [chat, terminal]);
        expect(note).toContain('Added: "dev server" (terminal).');
        expect(note).toContain('Removed: "Sprint goals" (text).');
    });
});
