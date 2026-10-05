import { describe, expect, test } from 'bun:test';
import type { ProvenanceReadResult, ProvenanceReviewState, ProvenanceRun } from '@ruimte/contracts';
import { type FakeEditor, FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { ManualTimers } from '@/language/timers';
import { AgentChanges } from './agent-changes';
import { AgentReview, revertNote } from './agent-review';
import { agentReviewOf } from './agent-review-registry';

const DISK = ['one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight'].join('\n') + '\n';

function run(id: string, start: number, end: number, extra: Partial<ProvenanceRun> = {}): ProvenanceRun {
    return {
        id,
        chatId: 'chat-a',
        turnId: 'turn-1',
        turn: 4,
        provider: 'claude',
        at: 1_000,
        promptExcerpt: '',
        start,
        end,
        before: ['old'],
        review: 'pending',
        via: 'tool',
        ...extra
    };
}

async function flush(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) {
        await Promise.resolve();
    }
}

interface Setup {
    editor: FakeEditor;
    changes: AgentChanges;
    review: AgentReview;
    timers: ManualTimers;
    marked: Array<{ ids: readonly string[]; state: ProvenanceReviewState }>;
    offered: Array<{ chatId: string; text: string }>;
    focused: string[];
    daemon: { runs: ProvenanceRun[] };
    failMark: { value: boolean };
}

function setup(runs: ProvenanceRun[], mode: 'review' | 'gutter' | 'off' = 'review', chats: readonly string[] = ['chat-a']): Setup {
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: DISK, theme: 'light' });
    const timers = new ManualTimers();
    const daemon = { runs };
    const marked: Setup['marked'] = [];
    const offered: Setup['offered'] = [];
    const focused: string[] = [];
    const failMark = { value: false };
    const changes = new AgentChanges(
        editor,
        {
            read: async (): Promise<ProvenanceReadResult> => ({ mtime: 10, lines: 8, runs: daemon.runs }),
            disk: () => ({ text: DISK, mtime: 10 }),
            nameOf: () => 'Claude Code'
        },
        timers
    );
    const review = new AgentReview(editor, changes, {
        mark: async (ids, state) => {
            if (failMark.value) {
                throw new Error('refused');
            }
            marked.push({ ids, state });
            // The machine takes the state; its runs come back without them.
            daemon.runs = daemon.runs.map((candidate) => (ids.includes(candidate.id) ? { ...candidate, review: state } : candidate));
        },
        offer: (chatId, text) => offered.push({ chatId, text }),
        focusChat: (chatId) => focused.push(chatId),
        chatExists: (chatId) => chats.includes(chatId),
        label: () => 'src/score.ts',
        language: () => 'typescript'
    });
    changes.configure({ mode, attribution: true });
    return { editor, changes, review, timers, marked, offered, focused, daemon, failMark };
}

const rowIds = (editor: FakeEditor): string[] => (editor.widgetsByOwner.get('review') ?? []).map((row) => row.id);

describe('the rows of a review', () => {
    test('a settled turn gets a row per run, with its lines tinted as added', async () => {
        const { editor } = setup([run('r1', 2, 3), run('r2', 6, 6)]);
        await flush();
        expect(rowIds(editor)).toEqual(['r1', 'r2']);
        expect((editor.widgetsByOwner.get('review') ?? []).map((row) => [row.line, row.placement])).toEqual([
            [1, 'above'],
            [5, 'above']
        ]);
        expect(editor.lineHighlights.map((highlight) => [highlight.startLine, highlight.endLine, highlight.sign])).toEqual([
            [2, 3, '+'],
            [6, 6, '+']
        ]);
    });

    test('a turn that still writes has none until it is done', async () => {
        const { editor, changes } = setup([run('r1', 2, 3)]);
        changes.changed({ projectId: 'p1', path: '/work/score.ts', chatId: 'chat-a', turnId: 'turn-1', live: true });
        await flush();
        expect(rowIds(editor)).toEqual([]);

        changes.changed({ projectId: 'p1', path: '/work/score.ts', chatId: 'chat-a', turnId: 'turn-1', live: false });
        await flush();
        expect(rowIds(editor)).toEqual(['r1']);
    });

    test('gutter mode draws the bars and no rows, and off draws nothing', async () => {
        const gutter = setup([run('r1', 2, 3)], 'gutter');
        await flush();
        expect(rowIds(gutter.editor)).toEqual([]);
        expect(gutter.editor.attributionMarks).toHaveLength(1);

        const off = setup([run('r1', 2, 3)], 'off');
        await flush();
        expect(rowIds(off.editor)).toEqual([]);
        expect(off.editor.attributionMarks).toEqual([]);
        expect(off.review.store.getState().items).toEqual([]);
    });

    test('a run already kept has no row and keeps its bar', async () => {
        const { editor } = setup([run('r1', 2, 3, { review: 'kept' })]);
        await flush();
        expect(rowIds(editor)).toEqual([]);
        expect(editor.attributionMarks).toHaveLength(1);
    });

    test('lines removed with nothing added stand in front of the line behind them', async () => {
        const { editor, review } = setup([run('r1', 4, 3, { before: ['gone one', 'gone two'] })]);
        await flush();
        expect((editor.widgetsByOwner.get('review') ?? []).map((row) => [row.id, row.line, row.placement])).toEqual([['r1', 3, 'above']]);
        expect(editor.lineHighlights).toEqual([]);
        expect(review.store.getState().items[0]).toMatchObject({ undoable: true, startLine: 4 });
    });
});

describe('Keep', () => {
    test('marks the run kept, takes its row away and leaves the bar', async () => {
        const { editor, review, marked } = setup([run('r1', 2, 3), run('r2', 6, 6)]);
        await flush();
        review.keep('r1');
        expect(rowIds(editor)).toEqual(['r2']);
        await flush();
        expect(marked).toEqual([{ ids: ['r1'], state: 'kept' }]);
        expect(rowIds(editor)).toEqual(['r2']);
        expect(editor.attributionMarks).toHaveLength(2);
        expect(editor.getText()).toBe(DISK);
    });

    test('a refusal of the machine brings the row back', async () => {
        const { editor, review, failMark } = setup([run('r1', 2, 3)]);
        await flush();
        failMark.value = true;
        review.keep('r1');
        await flush();
        expect(rowIds(editor)).toEqual(['r1']);
    });

    test('Keep all marks every run at once', async () => {
        const { editor, review, marked } = setup([run('r1', 2, 3), run('r2', 6, 6)]);
        await flush();
        review.keepAll();
        await flush();
        expect(marked).toEqual([{ ids: ['r1', 'r2'], state: 'kept' }]);
        expect(rowIds(editor)).toEqual([]);
    });
});

describe('Undo', () => {
    test('puts the lines the run replaced back as one edit, marks it undone and tells the chat in its draft', async () => {
        const { editor, review, marked, offered, focused } = setup([run('r1', 2, 3, { before: ['was two'] })]);
        await flush();
        const sources: string[] = [];
        editor.onTextChange((change) => sources.push(change.source));

        review.undo('r1');
        await flush();

        expect(editor.getText()).toBe(DISK.replace('two\nthree', 'was two'));
        expect(sources).toEqual(['command']);
        expect(marked).toEqual([{ ids: ['r1'], state: 'undone' }]);
        expect(offered).toEqual([{ chatId: 'chat-a', text: 'I reverted your change in src/score.ts:2-3.\n\n' }]);
        expect(focused).toEqual([]);
    });

    test('puts back lines the agent removed', async () => {
        const { editor, review } = setup([run('r1', 4, 3, { before: ['gone one', 'gone two'] })]);
        await flush();
        review.undo('r1');
        await flush();
        expect(editor.getText()).toBe(DISK.replace('four', 'gone one\ngone two\nfour'));
    });

    test('a run without the lines it replaced offers Comment only', async () => {
        const { editor, review, offered, marked } = setup([run('r1', 2, 3, { before: undefined })]);
        await flush();
        expect(review.store.getState().items[0]!.undoable).toBe(false);
        review.undo('r1');
        await flush();
        expect(editor.getText()).toBe(DISK);
        expect(marked).toEqual([]);
        expect(offered).toEqual([]);
    });

    test('a run an edit cut through cannot be put back', async () => {
        const { editor, review, timers } = setup([run('r1', 2, 5)]);
        await flush();
        editor.type(DISK.replace('three\n', 'three\nTYPED\n'));
        timers.advance(200);
        expect(review.store.getState().items[0]).toMatchObject({ undoable: false, run: { id: 'r1' } });
    });

    test('a chat that is gone gets no line', async () => {
        const { review, offered, marked } = setup([run('r1', 2, 3)], 'review', []);
        await flush();
        review.undo('r1');
        await flush();
        expect(marked).toHaveLength(1);
        expect(offered).toEqual([]);
    });

    test('Undo all puts back every run that can be, in one edit, and says so once per chat', async () => {
        const { editor, review, marked, offered } = setup(
            [
                run('r1', 2, 3, { before: ['was two'] }),
                run('r2', 4, 4, { before: ['was four'] }),
                run('r3', 7, 7, { before: undefined }),
                run('r4', 6, 6, { before: ['was six'], chatId: 'chat-b' })
            ],
            'review',
            ['chat-a', 'chat-b']
        );
        await flush();
        const sources: string[] = [];
        editor.onTextChange((change) => sources.push(change.source));

        review.undoAll();
        await flush();

        expect(editor.getText()).toBe('one\nwas two\nwas four\nfive\nwas six\nseven\neight\n');
        expect(sources).toEqual(['command']);
        expect(marked).toEqual([{ ids: ['r1', 'r2', 'r4'], state: 'undone' }]);
        expect(offered).toEqual([
            { chatId: 'chat-a', text: 'I reverted your changes in src/score.ts:2-3, src/score.ts:4.\n\n' },
            { chatId: 'chat-b', text: 'I reverted your change in src/score.ts:6.\n\n' }
        ]);
        expect(revertNote(['a.ts:1'])).toBe('I reverted your change in a.ts:1.');
    });
});

describe('Comment', () => {
    test('goes to the chat draft with the file, the lines and the code, and brings the chat into view', async () => {
        const { review, offered, focused } = setup([run('r1', 2, 3)]);
        await flush();
        review.openComment('r1');
        review.setComment('  use a smaller number ');
        review.submitComment();

        expect(offered).toEqual([{ chatId: 'chat-a', text: 'src/score.ts:2-3\n```typescript\ntwo\nthree\n```\nuse a smaller number\n\n' }]);
        expect(focused).toEqual(['chat-a']);
        expect(review.store.getState().commenting).toBeNull();
    });

    test('an empty comment goes nowhere', async () => {
        const { review, offered } = setup([run('r1', 2, 3)]);
        await flush();
        review.openComment('r1');
        review.submitComment();
        expect(offered).toEqual([]);
        expect(review.store.getState().commenting).not.toBeNull();
    });
});

describe('stepping through the changes', () => {
    test('goes to the next change after the caret and wraps, and back to the one before it', async () => {
        const { editor, review } = setup([run('r1', 2, 3), run('r2', 6, 6)]);
        await flush();
        review.step(1);
        expect(editor.revealedLine).toBe(2);
        editor.setCaret({ line: 1, character: 0 });
        review.step(1);
        expect(editor.revealedLine).toBe(6);
        editor.setCaret({ line: 5, character: 0 });
        review.step(1);
        expect(editor.revealedLine).toBe(2);
        // Revealing a line puts the caret there, which the fake leaves to the test.
        editor.setCaret({ line: 1, character: 0 });
        review.step(-1);
        expect(editor.revealedLine).toBe(6);
        expect(review.store.getState().current).toBe(1);
    });

    test('the editor knows its review for the commands', async () => {
        const { editor, review } = setup([]);
        expect(agentReviewOf(editor)).toBe(review);
        review.dispose();
        expect(agentReviewOf(editor)).toBeNull();
    });
});
