import { describe, expect, test } from 'bun:test';
import { AgentKindSchema, type ContextSource } from '@ruimte/contracts';
import { NODE_VERB_KINDS } from '../canvas/node-verb.ts';
import { chatPrompt, contextChangeNote, contextHint, contextPrompt, hookContext, verbsNote } from './context-note.ts';

const VERBS_NOTE = verbsNote({ depth: 0 });

const text: ContextSource = { id: 'text-1', kind: 'text', title: 'Sprint goals' };
const terminal: ContextSource = { id: 'term-1', kind: 'terminal', title: 'dev server' };
const chat: ContextSource = { id: 'chat-1', kind: 'chat', title: 'planner' };
const device: ContextSource = { id: 'dev-1', kind: 'device', title: 'iPhone 18 Pro Max' };

const many = Array.from({ length: 8 }, (_, i): ContextSource => ({ id: `t${i}`, kind: 'text', title: `Note ${i}` }));

describe('contextHint', () => {
    test('is silent without links and names each source with its kind', () => {
        expect(contextHint([])).toBeNull();
        expect(contextHint([text, terminal])).toBe(
            'Ruimte: linked context is available with ruimte-context (list, read <id>): "Sprint goals" (text), "dev server" (terminal).'
        );
    });

    test('caps the names and counts the rest', () => {
        const hint = contextHint(many);
        expect(hint).toContain('"Note 4" (text) and 3 more.');
        expect(hint).not.toContain('Note 5');
    });
});

describe('verbsNote', () => {
    test('names computer use only while it is on for this machine', () => {
        for (const standalone of [false, true]) {
            expect(verbsNote({ depth: 0, standalone })).not.toContain('computer');
            expect(verbsNote({ depth: 0, standalone, computer: true })).toContain('`ruimte-context computer`');
            // A person who paused or stopped the agent is waited for, not called around.
            expect(verbsNote({ depth: 0, standalone, computer: true })).toContain('pause you, take over or stop you');
            expect(verbsNote({ depth: 0, standalone, computer: true })).toContain('instead of calling again in a loop');
            expect(verbsNote({ depth: 0, standalone, computer: true })).toContain('You work in the background by default');
            expect(verbsNote({ depth: 0, standalone, computer: true })).toContain('ask them before you use `--front`');
        }
        expect(hookContext('SessionStart', [], { computer: true })).toContain('`ruimte-context computer`');
        expect(chatPrompt({ sources: [], depth: 0, computer: true })).toContain('`ruimte-context computer`');
    });

    test('names the device noun only while a device node is linked in', () => {
        const phone = {
            id: 'phone-1',
            kind: 'device' as const,
            title: 'Phone',
            device: { platform: 'ios' as const, kind: 'simulator' as const, name: 'iPhone', runtime: 'iOS 27.0' }
        };
        expect(chatPrompt({ sources: [], depth: 0 })).not.toContain('ruimte-context device');
        expect(chatPrompt({ sources: [phone], depth: 0 })).toContain('`ruimte-context device`');
        expect(hookContext('SessionStart', [phone])).toContain('`ruimte-context device`');
        expect(verbsNote({ depth: 0, standalone: true, device: true })).toContain('`ruimte-context device`');
    });

    test('offers team and agent at depth 0, only agent at depth 1 and neither below', () => {
        expect(VERBS_NOTE).toContain('`agent <cli>` for one, `team` for several in parallel');
        expect(VERBS_NOTE).toContain('answer yourself whatever you can');
        expect(VERBS_NOTE).toContain('end your turn instead of polling');
        const helper = verbsNote({ depth: 1 });
        expect(helper).toContain('opens a helper agent with `agent <cli>`');
        expect(helper).toContain('answer yourself whatever you can');
        expect(helper).not.toContain('`team`');
        expect(helper).toContain('--task');
        // Named where the verb is offered, since a prompt asks for a CLI by name and never by flag.
        for (const cli of AgentKindSchema.options) {
            expect(VERBS_NOTE).toContain(cli);
            expect(helper).toContain(cli);
        }
        for (const note of [VERBS_NOTE, helper]) {
            // A person asking for a second agent wants a node, so the note must not read as a nudge to delegate inside the CLI.
            expect(note).toContain('never a subagent of your own');
        }
        const deepest = verbsNote({ depth: 2 });
        expect(deepest).not.toContain('`agent`');
        expect(deepest).not.toContain('--task');
        expect(deepest).not.toContain('subagent');
        for (const note of [VERBS_NOTE, helper, deepest]) {
            // Named at every depth, since a model told only about "nodes" writes the note the person asked for as a file.
            for (const kind of NODE_VERB_KINDS) {
                expect(note).toContain(kind);
            }
            expect(note).toContain('not a file you write');
            expect(note).toContain('`ruimte-context help <verb or noun>`');
            expect(note).toContain('a command you run in your shell, not a tool');
            expect(note).toEndWith('never by id.');
            expect(note).not.toContain('  ');
        }
    });
});

describe('contextPrompt', () => {
    test('names the sources a chat has and says the canvas comes first', () => {
        expect(contextPrompt([])).toBeNull();
        expect(contextPrompt([device])).toBe(
            'Ruimte: linked context is available with ruimte-context (list, read <id>): "iPhone 18 Pro Max" (device). This is what the person means, so prefer it over anything your own tools or servers turn up.'
        );
    });

    test('caps the names the way a shell hint does', () => {
        const prompt = contextPrompt(many);
        expect(prompt).toContain('"Note 4" (text) and 3 more.');
        expect(prompt).not.toContain('Note 5');
    });
});

test('a standalone chat delegates inside the chat and only opens canvas agents when requested', () => {
    for (const depth of [0, 1, 2]) {
        const note = chatPrompt({ sources: [device], depth, standalone: true });
        // Defined by what it is not, a chat of its own starts every answer from the canvas it is not on.
        expect(note).not.toContain('not a node on a canvas');
        expect(note).not.toContain('standalone');
        expect(note).toContain('a command you run in your shell, not a tool');
        expect(note).toContain("your CLI's own subagents");
        expect(note).toContain('keep any model the person asked for');
        expect(note).toContain('Only when the person asks for an agent');
        expect(note).toContain('--view');
        expect(note).not.toContain('never a subagent of your own');
        expect(note).toContain('"iPhone 18 Pro Max" (device)');
    }
});

describe('chatPrompt', () => {
    test('always names the verbs for its depth, and the links by name only when there are some', () => {
        expect(chatPrompt({ sources: [], depth: 0 })).toBe(VERBS_NOTE);
        expect(chatPrompt({ sources: [], depth: 2 })).toBe(verbsNote({ depth: 2 }));
        expect(chatPrompt({ sources: [device, terminal], depth: 0 })).toBe(`${verbsNote({ depth: 0, device: true })} ${contextPrompt([device, terminal])}`);
        expect(chatPrompt({ sources: [device], depth: 0 })).toContain('"iPhone 18 Pro Max" (device)');
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

test('every agent learns how to send a notification only when requested', () => {
    for (const standalone of [false, true]) {
        const note = verbsNote({ depth: 0, standalone });
        expect(note).toContain('ruimte-context alert --text');
        expect(note).toContain('Use alert only when they asked for one');
    }
});
