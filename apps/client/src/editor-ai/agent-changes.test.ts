import { describe, expect, test } from 'bun:test';
import type { ProvenanceChangedEvent, ProvenanceReadResult, ProvenanceRun } from '@ruimte/contracts';
import { type FakeEditor, FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { ManualTimers } from '@/language/timers';
import type { AgentChangesSettings } from './agent-changes';
import { AgentChanges } from './agent-changes';
import { colorOfChat, drawnRuns } from './agent-runs';

const DISK = ['one', 'two', 'three', 'four', 'five', 'six'].join('\n') + '\n';

function run(id: string, start: number, end: number, extra: Partial<ProvenanceRun> = {}): ProvenanceRun {
    return {
        id,
        chatId: 'chat-a',
        turnId: 'turn-1',
        turn: 4,
        provider: 'claude',
        at: 1_000,
        promptExcerpt: 'Add rankCandidates',
        start,
        end,
        review: 'pending',
        via: 'tool',
        ...extra
    };
}

async function flush(): Promise<void> {
    for (let turn = 0; turn < 20; turn++) {
        await Promise.resolve();
    }
}

interface Setup {
    editor: FakeEditor;
    changes: AgentChanges;
    timers: ManualTimers;
    /* What the daemon answers next, and the text this client holds on disk. */
    answer: { value: ProvenanceReadResult };
    disk: { text: string; mtime: number };
    reads: { count: number };
    /* The turn each chat runs, as this client's chat list says; a chat that is not here is one it does not know. */
    turns: Map<string, string | null>;
}

function setup(runs: ProvenanceRun[] = [run('r1', 2, 3)], settings: AgentChangesSettings = { mode: 'gutter', attribution: true }): Setup {
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: DISK, theme: 'light' });
    const timers = new ManualTimers();
    const disk = { text: DISK, mtime: 10 };
    const answer = { value: { mtime: 10, lines: 6, runs } };
    const reads = { count: 0 };
    const turns = new Map<string, string | null>();
    const changes = new AgentChanges(
        editor,
        {
            read: async () => {
                reads.count++;
                return answer.value;
            },
            disk: () => disk,
            nameOf: (provider) => (provider === 'claude' ? 'Claude Code' : 'Codex'),
            activeTurn: (chatId) => turns.get(chatId)
        },
        timers
    );
    changes.configure(settings);
    return { editor, changes, timers, answer, disk, reads, turns };
}

const marks = (editor: FakeEditor): Array<[number, number]> => editor.attributionMarks.map((mark) => [mark.startLine, mark.endLine]);

describe('the bars', () => {
    test('a run is a bar on exactly its lines, in the color of its chat', async () => {
        const { editor } = setup();
        await flush();

        expect(marks(editor)).toEqual([[2, 3]]);
        expect(editor.attributionMarks[0]!.color).toBe(colorOfChat('chat-a'));
    });

    test('the same chat has the same color in every file and another chat may have another', () => {
        expect(colorOfChat('chat-a')).toBe(colorOfChat('chat-a'));
        const colors = new Set(Array.from({ length: 30 }, (_, index) => colorOfChat(`chat-${index}`)));
        expect(colors.size).toBeGreaterThan(1);
    });

    test('unsaved edits are respected: lines move with the text and a line typed inside a run splits it', async () => {
        const { editor, timers } = setup([run('r1', 2, 5)]);
        await flush();
        editor.type(`top\n${DISK}`);
        timers.advance(200);
        expect(marks(editor)).toEqual([[3, 6]]);

        editor.type(`top\n${DISK.replace('three\n', 'three\nTYPED\n')}`);
        timers.advance(200);
        expect(marks(editor)).toEqual([
            [3, 4],
            [6, 7]
        ]);
    });

    test('text that arrives from disk for a clean draft puts the bars on the lines the agent wrote', async () => {
        const { editor, changes, answer, disk } = setup([]);
        await flush();
        const written = DISK.replace('three', 'three\nthree-b\nthree-c');
        // The daemon read the new text; the client's disk and then its editor follow.
        answer.value = { mtime: 11, lines: 8, runs: [run('r2', 4, 5)] };
        disk.text = written;
        disk.mtime = 11;
        changes.refresh();
        await flush();
        editor.setText(written);
        await flush();

        expect(marks(editor)).toEqual([[4, 5]]);
    });

    test('runs of another version of the file wait until the client holds that version', async () => {
        const { editor, changes, answer, disk } = setup([]);
        await flush();
        answer.value = { mtime: 11, lines: 6, runs: [run('r1', 2, 3)] };
        changes.refresh();
        await flush();
        expect(marks(editor)).toEqual([]);

        disk.mtime = 11;
        changes.refresh();
        await flush();
        expect(marks(editor)).toEqual([[2, 3]]);
    });

    test('without attribution there are no bars and no card', async () => {
        const { editor, changes } = setup(undefined, { mode: 'gutter', attribution: false });
        await flush();
        expect(editor.attributionMarks).toEqual([]);

        changes.changed({ projectId: 'p1', path: '/a', chatId: 'chat-a', turnId: 'turn-1', live: true });
        await flush();
        expect(editor.attributionMarks).toEqual([]);
        expect(editor.remoteCursors).toHaveLength(1);
    });

    test('off draws nothing and asks nothing', async () => {
        const { editor, changes, reads } = setup(undefined, { mode: 'off', attribution: true });
        changes.changed({ projectId: 'p1', path: '/a', chatId: 'chat-a', turnId: 'turn-1', live: true });
        changes.refresh();
        await flush();

        expect(reads.count).toBe(0);
        expect(editor.attributionMarks).toEqual([]);
        expect(editor.remoteCursors).toEqual([]);
        expect(changes.getState()).toEqual({ live: null, hover: null });
    });

    test('turning the mode off clears what was drawn and turning it on draws again', async () => {
        const { editor, changes } = setup();
        await flush();
        changes.configure({ mode: 'off', attribution: true });
        expect(editor.attributionMarks).toEqual([]);

        changes.configure({ mode: 'gutter', attribution: true });
        await flush();
        expect(marks(editor)).toEqual([[2, 3]]);
    });
});

describe('a turn that is writing', () => {
    const live: ProvenanceChangedEvent = { projectId: 'p1', path: '/a', chatId: 'chat-a', turnId: 'turn-1', live: true };

    test('the chip names who writes and the named cursor stands at the end of the last run', async () => {
        const { editor, changes } = setup([run('r1', 2, 2), run('r2', 4, 5, { at: 2_000 })]);
        changes.changed(live);
        await flush();

        expect(changes.getState().live).toEqual({ chatId: 'chat-a', turnId: 'turn-1' });
        expect(editor.remoteCursors).toHaveLength(1);
        expect(editor.remoteCursors[0]).toMatchObject({ name: 'Claude Code', position: { line: 4 }, color: colorOfChat('chat-a') });
    });

    test('the end of the turn takes the chip and the cursor away and leaves the bars', async () => {
        const { editor, changes } = setup();
        changes.changed(live);
        await flush();
        changes.changed({ ...live, live: false });
        await flush();

        expect(changes.getState().live).toBeNull();
        expect(editor.remoteCursors).toEqual([]);
        expect(marks(editor)).toEqual([[2, 3]]);
    });

    test("the end of another chat's turn does not stop this one", async () => {
        const { changes } = setup();
        changes.changed(live);
        changes.changed({ ...live, chatId: 'chat-b', live: false });
        expect(changes.getState().live).toEqual({ chatId: 'chat-a', turnId: 'turn-1' });
    });
});

describe('a turn whose end was never heard', () => {
    const live: ProvenanceChangedEvent = { projectId: 'p1', path: '/a', chatId: 'chat-a', turnId: 'turn-1', live: true };

    test('the chat list saying the chat runs nothing takes the chip and the cursor away', async () => {
        const { editor, changes, turns } = setup();
        turns.set('chat-a', 'turn-1');
        changes.changed(live);
        await flush();
        expect(editor.remoteCursors).toHaveLength(1);

        turns.set('chat-a', null);
        changes.chatsChanged();
        expect(changes.getState().live).toBeNull();
        expect(editor.remoteCursors).toEqual([]);
        expect(marks(editor)).toEqual([[2, 3]]);
    });

    test('so does the chat running another turn', async () => {
        const { changes, turns } = setup();
        changes.changed(live);
        await flush();
        turns.set('chat-a', 'turn-2');
        changes.chatsChanged();
        expect(changes.getState().live).toBeNull();
    });

    test('a chat that is still on the turn, or one this client does not know, keeps its chip', async () => {
        const { changes, turns } = setup();
        changes.changed(live);
        await flush();
        changes.chatsChanged();
        expect(changes.getState().live).not.toBeNull();
        turns.set('chat-a', 'turn-1');
        changes.chatsChanged();
        expect(changes.getState().live).not.toBeNull();
    });
});

describe('the card on a bar', () => {
    test('a bar under the pointer opens the card of its run and leaving closes it after a moment', async () => {
        const { editor, changes, timers } = setup([run('r1', 2, 3, { turn: 4 })]);
        await flush();
        editor.hoverAttribution('r1:0', { left: 10, top: 20, right: 13, bottom: 40 });

        expect(changes.getState().hover).toMatchObject({
            run: { id: 'r1', turn: 4, promptExcerpt: 'Add rankCandidates' },
            startLine: 2,
            endLine: 3,
            rect: { left: 10 }
        });

        editor.hoverAttribution(null);
        expect(changes.getState().hover).not.toBeNull();
        timers.advance(200);
        expect(changes.getState().hover).toBeNull();
    });

    test('the pointer inside the card keeps it open', async () => {
        const { editor, changes, timers } = setup();
        await flush();
        editor.hoverAttribution('r1:0');
        editor.hoverAttribution(null);
        changes.holdCard(true);
        timers.advance(1000);
        expect(changes.getState().hover).not.toBeNull();

        changes.holdCard(false);
        timers.advance(200);
        expect(changes.getState().hover).toBeNull();
    });
});

describe('drawnRuns', () => {
    const lines = (text: string): string[] => text.split(' ');

    test('lines replaced since lose the bar and the pieces keep their run', () => {
        const drawn = drawnRuns([run('r1', 1, 5)], lines('a b c d e'), lines('a b X d e'));
        expect(drawn.map((piece) => [piece.markId, piece.startLine, piece.endLine])).toEqual([
            ['r1:0', 1, 2],
            ['r1:1', 4, 5]
        ]);
    });

    test('a run that only removed lines has no bar', () => {
        expect(drawnRuns([run('r1', 3, 2)], lines('a b d'), lines('a b d'))).toEqual([]);
    });
});
