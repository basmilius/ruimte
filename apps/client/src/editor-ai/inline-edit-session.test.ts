import { beforeEach, describe, expect, test } from 'bun:test';
import type { ChatInfo, ChatItem } from '@ruimte/contracts';
import type { ChatState } from '@ruimte/agents-react/state/chats';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import type { Editor } from '@ruimte/smart-editor';
import type { InlineEditRecord } from './inline-edit-record';
import { InlineEditSession, inlineSessionOf, lastTurnId, turnOutcome, type InlineEditInit } from './inline-edit-session';
import { Harness, RANGE, SELECTED, TEXT, at } from './inline-edit-test-helpers';

let harness: Harness;
let editor: Editor;

function init(extra: Partial<InlineEditInit> = {}): InlineEditInit {
    return {
        projectId: 'p1',
        path: '/work/app/src/score.ts',
        storedPath: 'src/score.ts',
        language: 'typescript',
        range: RANGE,
        selectedText: SELECTED,
        span: { startLine: 2, endLine: 3 },
        problems: [{ line: 2, severity: 'error', message: 'Bad', code: 'ts 1' }],
        provider: 'claude',
        model: 'opus',
        ...extra
    };
}

function mounted(text = TEXT): Editor {
    return new FakeEditorEngine().mount({} as HTMLElement, { text, theme: 'light' });
}

function session(extra: Partial<InlineEditInit> = {}): InlineEditSession {
    const made = new InlineEditSession('local', harness.deps, init(extra));
    made.attach(editor);
    return made;
}

const BLOCK = '```replacement\n  if (!need.length) return 1;\n  return hits / need.length;\n```\nSimplified the guard.';

beforeEach(() => {
    harness = new Harness();
    editor = mounted();
});

describe('running an inline edit', () => {
    test('makes the chat once, sends the instruction with the file, the lines and the problems, and waits for the turn', async () => {
        const made = session();

        await made.start('  simplify the guard ');

        expect(harness.created).toEqual([{ projectId: 'p1', path: 'src/score.ts', provider: 'claude', model: 'opus' }]);
        expect(harness.calls).toEqual(['newChat', 'open chat-1']);
        expect(harness.sent).toHaveLength(1);
        expect(harness.sent[0]).toMatchObject({ chatId: 'chat-1', mentions: ['src/score.ts'] });
        expect(harness.sent[0]?.text).toStartWith('simplify the guard\n\nFile: @src/score.ts');
        expect(harness.sent[0]?.text).toContain(`\`\`\`typescript\n${SELECTED}\n\`\`\``);
        expect(harness.sent[0]?.text).toContain('- line 2: error: Bad (ts 1)');
        expect(made.store.getState()).toMatchObject({ phase: 'running', instruction: 'simplify the guard', proposal: null });
        expect(harness.records.get('/work/app/src/score.ts')).toMatchObject({
            chatId: 'chat-1',
            instruction: 'simplify the guard',
            range: RANGE,
            projectId: 'p1'
        });
    });

    test('shows the replacement when the turn settles, with how long it took and what the agent said', async () => {
        const made = session();
        await made.start('simplify');
        harness.clock = 7_500;

        harness.answer('chat-1', 'turn-1', BLOCK);

        expect(made.store.getState()).toMatchObject({
            phase: 'proposal',
            proposal: '  if (!need.length) return 1;\n  return hits / need.length;',
            answer: 'Simplified the guard.',
            startedAt: 1_000,
            endedAt: 7_500,
            stale: false
        });
        // Nothing of the file moved: the file waits for Apply.
        expect(editor.getText()).toBe(TEXT);
    });

    test('shows the answer as text when it has no block, and says so when the turn failed', async () => {
        const answered = session();
        await answered.start('is this right?');
        harness.answer('chat-1', 'turn-1', 'It is right as it stands.');
        expect(answered.store.getState()).toMatchObject({ phase: 'answer', proposal: null, answer: 'It is right as it stands.' });

        harness = new Harness();
        const failed = session({ path: '/work/app/src/other.ts' });
        await failed.start('x');
        harness.answer('chat-1', 'turn-1', '', 'error');
        expect(failed.store.getState()).toMatchObject({ phase: 'failed', proposal: null });
    });

    test('a follow-up goes to the same chat as a plain message, and its block replaces the proposal', async () => {
        const made = session();
        await made.start('simplify');
        harness.answer('chat-1', 'turn-1', BLOCK);

        await made.followUp(' and rename need ');

        expect(harness.created).toHaveLength(1);
        expect(harness.sent[1]).toEqual({ chatId: 'chat-1', text: 'and rename need', mentions: [] });
        expect(made.store.getState()).toMatchObject({ phase: 'running', proposal: null, instruction: 'and rename need' });
        harness.answer('chat-1', 'turn-2', '```replacement\nreturn 0;\n```');
        expect(made.store.getState()).toMatchObject({ phase: 'proposal', proposal: 'return 0;' });
    });

    test('a follow-up while the agent still works is not sent', async () => {
        const made = session();
        await made.start('simplify');

        await made.followUp('more');

        expect(harness.sent).toHaveLength(1);
    });

    test('a new edit in a file hands the old chat back to be removed', async () => {
        const first = session();
        await first.start('one');
        harness.deps.newChat = async (payload) => {
            harness.created.push(payload);
            return { chatId: 'chat-2', viewId: 'chat-2' };
        };

        const second = session();
        await second.start('two');

        expect(harness.calls).toContain('remove chat-1');
        expect(harness.records.get('/work/app/src/score.ts')?.chatId).toBe('chat-2');
    });

    test('says the chat waits on a person while an approval is open', async () => {
        const made = session();
        await made.start('simplify');

        harness.add('chat-1', {
            id: 'ask-1',
            kind: 'approval',
            createdAt: 1_000,
            turnId: 'turn-1',
            requestId: 'r1',
            toolUseId: null,
            toolName: 'Edit',
            input: {},
            description: null,
            canAllowAlways: false,
            decision: 'pending'
        } as unknown as ChatItem);

        expect(made.store.getState().needsYou).toBe(true);
    });

    test('a chat that could not be made fails the card and keeps nothing', async () => {
        harness.deps.newChat = async () => {
            throw new Error('The machine is not connected.');
        };
        const made = session();

        await made.start('simplify');

        expect(made.store.getState()).toMatchObject({ phase: 'failed', error: 'The machine is not connected.' });
        expect(harness.records.size).toBe(0);
    });
});

describe('applying a proposal', () => {
    async function proposed(): Promise<InlineEditSession> {
        const made = session();
        await made.start('simplify');
        harness.answer('chat-1', 'turn-1', BLOCK);
        return made;
    }

    test('replaces the selected lines in one step of the editor and leaves the new text selected', async () => {
        const made = await proposed();
        let edits = 0;
        editor.onTextChange(() => (edits += 1));

        expect(await made.apply()).toBe('applied');

        expect(editor.getText()).toBe(
            ['function skillOverlap(have, need) {', '  if (!need.length) return 1;', '  return hits / need.length;', '}', ''].join('\n')
        );
        expect(edits).toBe(1);
        expect(editor.getSelection()).toEqual({ start: at(1, 0), end: at(2, 28) });
    });

    test('takes the chat away afterwards, with its record, and ends the session', async () => {
        const made = await proposed();

        await made.apply();

        expect(harness.calls.slice(-2)).toEqual(['release chat-1', 'remove chat-1']);
        expect(harness.records.size).toBe(0);
        expect(made.store.getState().closed).toBe(true);
        expect(inlineSessionOf('local', '/work/app/src/score.ts')).toBeNull();
    });

    test('still finds the lines after text was inserted above them', async () => {
        const made = await proposed();
        editor.applyEdits([{ range: { start: at(0, 0), end: at(0, 0) }, text: '// header\n' }]);

        expect(await made.apply()).toBe('applied');

        expect(editor.getText().split('\n').slice(0, 3)).toEqual(['// header', 'function skillOverlap(have, need) {', '  if (!need.length) return 1;']);
    });

    test('refuses when the selected text changed, leaves the file alone and keeps the chat', async () => {
        const made = await proposed();
        editor.applyEdits([{ range: { start: at(1, 2), end: at(1, 4) }, text: 'IF' }]);
        const before = editor.getText();

        expect(await made.apply()).toBe('stale');

        expect(editor.getText()).toBe(before);
        expect(made.store.getState()).toMatchObject({ stale: true, closed: false });
        expect(harness.calls).not.toContain('remove chat-1');
    });

    test('refuses in a read only editor', async () => {
        const made = await proposed();
        editor.setReadOnly(true);

        expect(await made.apply()).toBe('readonly');

        expect(editor.getText()).toBe(TEXT);
    });

    test('has nothing to apply for an answer without a block', async () => {
        const made = session();
        await made.start('x');
        harness.answer('chat-1', 'turn-1', 'Nothing to change.');

        expect(await made.apply()).toBe('nothing');
    });

    test('with no editor, stages the new text of the file as a draft after the same check', async () => {
        const made = await proposed();
        made.detach();

        expect(await made.apply()).toBe('applied');

        expect(harness.staged).toEqual([
            {
                path: '/work/app/src/score.ts',
                text: ['function skillOverlap(have, need) {', '  if (!need.length) return 1;', '  return hits / need.length;', '}', ''].join('\n')
            }
        ]);
        expect(made.store.getState().closed).toBe(true);
    });

    test('with no editor, finds the lines by their text when the file moved on, and refuses when the text changed', async () => {
        const moved = await proposed();
        moved.detach();
        harness.file = { text: `// one\n// two\n${TEXT}`, mtime: 8 };

        expect(await moved.apply()).toBe('applied');
        expect(harness.staged[0]?.text.split('\n')[3]).toBe('  if (!need.length) return 1;');

        harness = new Harness();
        const changed = await proposed();
        changed.detach();
        harness.file = { text: TEXT.replace('=== 0', '== 0'), mtime: 9 };

        expect(await changed.apply()).toBe('stale');
        expect(harness.staged).toEqual([]);
    });

    test('with no editor, a settled answer comes as a toast that applies it', async () => {
        const made = session();
        await made.start('simplify');
        made.detach();

        harness.answer('chat-1', 'turn-1', BLOCK);

        expect(harness.toasts).toEqual([{ title: 'The edit to score.ts is ready', action: 'Apply' }]);
    });

    test('with a closed card, a settled answer comes as a toast that shows it again', async () => {
        const made = session();
        await made.start('simplify');
        made.hide();

        harness.answer('chat-1', 'turn-1', BLOCK);

        expect(harness.toasts).toEqual([{ title: 'score.ts has an answer', action: 'Show' }]);
    });
});

describe('leaving an inline edit', () => {
    test('discarding removes the chat and its record', async () => {
        const made = session();
        await made.start('simplify');

        await made.discard();

        expect(harness.calls.slice(-2)).toEqual(['release chat-1', 'remove chat-1']);
        expect(harness.records.size).toBe(0);
        expect(made.store.getState().closed).toBe(true);
    });

    test('opening it as a chat lists the chat, forgets the record and keeps the chat running', async () => {
        const made = session();
        await made.start('simplify');

        await made.openAsChat();

        expect(harness.calls.slice(-2)).toEqual(['show chat-1', 'focus chat-1']);
        expect(harness.calls).not.toContain('remove chat-1');
        expect(harness.records.size).toBe(0);
        expect(made.store.getState().closed).toBe(true);
    });

    test('a card whose editor goes keeps working and applies to what it last knew', async () => {
        const made = session();
        await made.start('simplify');
        editor.applyEdits([{ range: { start: at(0, 0), end: at(0, 0) }, text: '// a\n// b\n' }]);

        made.detach();

        expect(made.store.getState()).toMatchObject({ attached: false, stale: false, range: { start: at(3, 0), end: at(4, 28) } });
    });
});

describe('an edit found again after a reload', () => {
    const record: InlineEditRecord = {
        chatId: 'chat-1',
        viewId: 'chat-1',
        projectId: 'p1',
        path: '/work/app/src/score.ts',
        range: RANGE,
        selectedText: SELECTED,
        instruction: 'simplify',
        provider: 'claude',
        model: null,
        createdAt: 500
    };

    test('reads the answer of the last turn from the chat and applies it where the lines still are', async () => {
        const chatId = 'chat-1';
        harness.deps.openChat = async () => {
            harness.chats.set(chatId, { info: {} as ChatInfo, items: {}, structure: {}, order: [] });
            harness.add(chatId, { id: 'turn-1', kind: 'turn', createdAt: 500, turnId: 'turn-1', state: 'done', endedAt: 2_500, costUsd: 0 } as ChatItem);
            harness.add(chatId, { id: 'a1', kind: 'assistant', createdAt: 600, turnId: 'turn-1', text: BLOCK, streaming: false } as ChatItem);
        };
        const made = InlineEditSession.fromRecord('local', harness.deps, record, 'src/score.ts', 'typescript');
        made.attach(editor);

        await made.restore();

        expect(made.store.getState()).toMatchObject({ phase: 'proposal', instruction: 'simplify', startedAt: 500, endedAt: 2_500, stale: false });
        expect(await made.apply()).toBe('applied');
    });

    test('says the selection changed when its text is gone from the file', async () => {
        const made = InlineEditSession.fromRecord('local', harness.deps, record, 'src/score.ts', 'typescript');
        made.attach(mounted('something else\nentirely\n'));

        expect(made.store.getState().stale).toBe(true);
    });

    test('forgets the record and ends when the hidden view is gone', async () => {
        harness.views.clear();
        harness.records.set(record.path, record);
        const made = InlineEditSession.fromRecord('local', harness.deps, record, 'src/score.ts', 'typescript');

        await made.restore();

        expect(harness.records.size).toBe(0);
        expect(made.store.getState().closed).toBe(true);
    });
});

describe('reading a turn off the thread', () => {
    test('is the newest turn, with the words of the agent and not of its subagents', () => {
        const items: Record<string, ChatItem> = {
            t1: { id: 't1', kind: 'turn', createdAt: 1, turnId: 't1', state: 'done', endedAt: 2, costUsd: 0 } as ChatItem,
            a1: { id: 'a1', kind: 'assistant', createdAt: 1, turnId: 't1', text: 'first', streaming: false } as ChatItem,
            t2: { id: 't2', kind: 'turn', createdAt: 3, turnId: 't2', state: 'done', endedAt: 5, costUsd: 0 } as ChatItem,
            a2: { id: 'a2', kind: 'assistant', createdAt: 3, turnId: 't2', text: 'second', streaming: false } as ChatItem,
            a3: { id: 'a3', kind: 'assistant', createdAt: 3, turnId: 't2', text: 'sub', streaming: false, parentToolUseId: 'x' } as ChatItem
        };
        const chat: ChatState = { info: {} as ChatInfo, items, structure: items, order: ['t1', 'a1', 't2', 'a2', 'a3'] };

        expect(lastTurnId(chat)).toBe('t2');
        expect(turnOutcome(chat, 't2')).toMatchObject({ state: 'done', text: 'second', startedAt: 3, endedAt: 5, needsYou: false });
        expect(turnOutcome(chat, 't9')).toMatchObject({ state: 'running', text: '' });
    });
});
