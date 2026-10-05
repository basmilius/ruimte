import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { FsReadResult, FsWriteResult, ProvenanceReadResult, ProvenanceRun } from '@ruimte/contracts';
import { type FakeEditor, FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { FakeLanguageTransport } from '@/language/fake-daemon';
import { bindDraftEditor } from '@/shell/panels/draft-editor';
import { endpointKey } from '@/state/keys';
import { type DraftLink, TextDrafts, useTextDrafts } from '@/state/text-drafts';
import { TransportError } from '@/transport/transport';
import { useConflictInfo } from './conflict-info';
import { mountConflictResolution, reviewConflict } from './conflict-wiring';

const MACHINE = 'm1';
const PATH = '/work/app/score.ts';
const FILE = { endpointId: MACHINE, projectId: 'p1', path: PATH };
const KEY = endpointKey(MACHINE, PATH);
const BASE = ['one', 'two', 'three', 'four', 'five', 'six', 'seven'].join('\n') + '\n';

async function flush(): Promise<void> {
    for (let turn = 0; turn < 30; turn++) {
        await Promise.resolve();
    }
}

/* A machine that holds one file and takes every write unless told to refuse the next. */
class FakeLink implements DraftLink {
    disk = { text: BASE, mtime: 1 };
    writes: Array<{ text: string; expectedMtime: number }> = [];
    refuseNext = false;

    read(): Promise<FsReadResult> {
        return Promise.resolve({ kind: 'text', text: this.disk.text, encoding: 'utf-8', size: this.disk.text.length, mtime: this.disk.mtime });
    }

    write(_path: string, text: string, expectedMtime: number): Promise<FsWriteResult> {
        this.writes.push({ text, expectedMtime });
        if (this.refuseNext) {
            this.refuseNext = false;
            return Promise.reject(new TransportError('stale', 'the file moved'));
        }
        this.disk = { text, mtime: this.disk.mtime + 1 };
        return Promise.resolve({ size: text.length, mtime: this.disk.mtime });
    }

    projectOpen(): Promise<void> {
        return Promise.resolve();
    }
}

function run(start: number, end: number, extra: Partial<ProvenanceRun> = {}): ProvenanceRun {
    return {
        id: 'r1',
        chatId: 'chat-a',
        turnId: 'turn-5',
        turn: 5,
        provider: 'claude',
        at: 5,
        promptExcerpt: '',
        start,
        end,
        review: 'pending',
        via: 'tool',
        ...extra
    };
}

let link: FakeLink;
let drafts: TextDrafts;
let editor: FakeEditor;
let transport: FakeLanguageTransport;
let release: () => void;
let unmount: () => void;
let answer: ProvenanceReadResult | null;
/* The conflict the beforeEach mounted, to call its answers from the test. */
let mounted: ReturnType<typeof mountConflictResolution> | null = null;

function lines(text: string): string {
    return text.replace(/\n$/, '').split('\n').join(' ');
}

beforeEach(() => {
    useTextDrafts.setState({ rows: {} });
    useConflictInfo.setState({ rows: {} });
    link = new FakeLink();
    drafts = new TextDrafts(() => link);
    release = drafts.hold(MACHINE, PATH);
    drafts.open(MACHINE, PATH, { text: BASE, mtime: 1 });
    editor = new FakeEditorEngine().mount({} as HTMLElement, { text: BASE, theme: 'light' });
    bindDraftEditor(editor, drafts, MACHINE, PATH);
    transport = new FakeLanguageTransport();
    answer = null;
    transport.answers.set('provenance.read', () => answer ?? { mtime: 0, lines: 0, runs: [] });
    mounted = mountConflictResolution(editor, transport, FILE, { drafts });
    unmount = mounted.unmount;
});

afterEach(() => {
    unmount();
    release();
    useTextDrafts.setState({ rows: {} });
});

/* The agent wrote the file while the draft was unsaved: the machine holds the text now and the client hears it. */
function agentWrites(text: string, mtime = 5): void {
    link.disk = { text, mtime };
    drafts.received(MACHINE, PATH, { text, mtime });
}

const draft = () => useTextDrafts.getState().rows[KEY]!;
const rowIds = (): string[] => (editor.widgetsByOwner.get('conflict') ?? []).map((row) => row.id);

describe('what merges by itself', () => {
    test('stretches only the other side changed land in the editor as one edit, and the draft saves over what the agent wrote', async () => {
        const changes: string[] = [];
        editor.type(BASE.replace('four', 'FOUR'));
        editor.onTextChange((change) => changes.push(change.source));

        agentWrites(BASE.replace('two', 'agent-two').replace('six', 'agent-six'));
        await flush();

        expect(editor.getText()).toBe(BASE.replace('two', 'agent-two').replace('four', 'FOUR').replace('six', 'agent-six'));
        expect(changes).toEqual(['command']);
        expect(editor.widgetsByOwner.size).toBe(0);
        expect(link.writes).toEqual([{ text: editor.getText(), expectedMtime: 5 }]);
        expect(draft()).toMatchObject({ problem: null, mtime: 6 });
        expect(draft().incoming).toBeUndefined();
    });

    test('an agent that wrote what the person typed asks nothing', async () => {
        editor.type(BASE.replace('three', 'same'));
        agentWrites(BASE.replace('three', 'same'));
        await flush();
        expect(editor.widgetsByOwner.size).toBe(0);
        expect(draft().problem).toBeNull();
    });
});

describe('a stretch both sides changed', () => {
    beforeEach(async () => {
        editor.type(BASE.replace('three', 'mine').replace('six', 'mine-six'));
        agentWrites(BASE.replace('three', 'theirs').replace('six', 'theirs-six'));
        await flush();
    });

    test('gets rows and a tint, and nothing saves while one waits', async () => {
        expect(rowIds()).toEqual(['5:0:yours', '5:0:theirs', '5:1:yours', '5:1:theirs']);
        const rows = editor.widgetsByOwner.get('conflict')!;
        expect(rows.map((row) => [row.line, row.placement])).toEqual([
            [2, 'above'],
            [2, 'below'],
            [5, 'above'],
            [5, 'below']
        ]);
        expect(editor.lineHighlights.map((highlight) => [highlight.startLine, highlight.endLine])).toEqual([
            [3, 3],
            [6, 6]
        ]);
        expect(editor.getText()).toContain('mine');
        expect(draft().problem).toMatchObject({ kind: 'changed' });
        expect(useConflictInfo.getState().rows[KEY]).toMatchObject({ open: 2 });
        expect(link.writes).toHaveLength(0);
    });

    test('Keep theirs puts the other side in the editor, Keep yours leaves the text, and the last answer saves', async () => {
        const { conflict } = mountedConflict();
        conflict.keepTheirs('5:0');
        expect(editor.getText()).toBe(BASE.replace('three', 'theirs').replace('six', 'mine-six'));
        expect(rowIds()).toEqual(['5:1:yours', '5:1:theirs']);
        expect(link.writes).toHaveLength(0);

        conflict.keepYours('5:1');
        await flush();
        expect(editor.widgetsByOwner.size).toBe(0);
        expect(editor.lineHighlights).toEqual([]);
        expect(link.writes).toEqual([{ text: BASE.replace('three', 'theirs').replace('six', 'mine-six'), expectedMtime: 5 }]);
        expect(draft()).toMatchObject({ problem: null, disk: BASE.replace('three', 'theirs').replace('six', 'mine-six') });
    });

    test('Keep both puts the person first and the other side behind', async () => {
        const { conflict } = mountedConflict();
        conflict.keepBoth('5:1');
        expect(lines(editor.getText())).toBe('one two mine three four five mine-six theirs-six seven'.replace('mine three', 'mine'));
    });

    test('typing above moves the rows with their lines, and the answer still lands on the right ones', async () => {
        const { conflict } = mountedConflict();
        editor.type(`top\n${editor.getText()}`);
        const rows = editor.widgetsByOwner.get('conflict')!;
        expect(rows.map((row) => row.line)).toEqual([3, 3, 6, 6]);

        conflict.keepTheirs('5:1');
        expect(lines(editor.getText())).toBe('top one two mine four five theirs-six seven');
    });

    test('the author of the lines comes from the runs of the file, and another program without one', async () => {
        const { conflict } = mountedConflict();
        expect(conflict.store.getState().blocks.map((block) => block.author)).toEqual([null, null]);

        answer = { mtime: 5, lines: 7, runs: [run(6, 6)] };
        await conflict.refreshAuthors();
        expect(conflict.store.getState().blocks.map((block) => block.author?.turn ?? null)).toEqual([null, 5]);
        expect(useConflictInfo.getState().rows[KEY]!.author).toMatchObject({ chatId: 'chat-a' });
    });

    test('the runs are asked for as soon as the review begins, whatever agent changes are set to, so Off still names who wrote the lines', async () => {
        const { conflict } = mountedConflict();
        await flush();
        expect(transport.callsOf('provenance.read')).toHaveLength(1);

        answer = { mtime: 5, lines: 7, runs: [run(6, 6)] };
        await conflict.refreshAuthors();
        expect(conflict.store.getState().blocks.map((block) => block.author?.turn ?? null)).toEqual([null, 5]);
    });

    test('Reload drops the review, and a new write is planned again over what the editor holds', async () => {
        const { conflict } = mountedConflict();
        conflict.keepTheirs('5:0');
        agentWrites(BASE.replace('three', 'theirs').replace('six', 'theirs-six').replace('one', 'agent-one'), 9);
        await flush();
        expect(lines(editor.getText())).toBe('agent-one two theirs four five mine-six seven');
        expect(rowIds()).toEqual(['9:0:yours', '9:0:theirs']);

        link.disk = { text: BASE, mtime: 12 };
        await drafts.reload(MACHINE, PATH);
        await flush();
        expect(editor.widgetsByOwner.size).toBe(0);
        expect(editor.getText()).toBe(BASE);
    });

    test('an edit that spans the edge of a block plans the rows again from the text', async () => {
        const { conflict } = mountedConflict();
        editor.type(BASE.replace('three', 'mine').replace('six', 'mine-six').replace('four', 'edited\nfour'));
        editor.type(editor.getText().replace('mine\nedited', 'mine-edited'));
        await flush();
        expect(conflict.store.getState().blocks).toHaveLength(2);
    });
});

describe('the bar that brings the review up', () => {
    test('reaches the editor that has the file, and nothing once it is gone', async () => {
        editor.type(BASE.replace('three', 'mine'));
        agentWrites(BASE.replace('three', 'theirs'));
        await flush();
        expect(reviewConflict(MACHINE, PATH)).toBe(true);
        expect(editor.revealedLine).toBe(3);
        unmount();
        expect(reviewConflict(MACHINE, PATH)).toBe(false);
        expect(editor.widgetsByOwner.size).toBe(0);
        expect(editor.lineHighlights).toEqual([]);
    });
});

describe('a stretch one side removed', () => {
    test('the person removed the lines and the agent changed them: the rows stand where the lines were', async () => {
        editor.type(BASE.replace('three\n', ''));
        agentWrites(BASE.replace('three', 'theirs'));
        await flush();
        const rows = editor.widgetsByOwner.get('conflict')!;
        expect(rows.map((row) => [row.id, row.line, row.placement])).toEqual([
            ['5:0:yours', 2, 'above'],
            ['5:0:theirs', 2, 'above']
        ]);
        expect(editor.lineHighlights).toEqual([]);
        const { conflict } = mountedConflict();
        conflict.keepTheirs('5:0');
        expect(editor.getText()).toBe(BASE.replace('three', 'theirs'));
    });

    test('the agent removed lines the person changed: Keep theirs removes them', async () => {
        editor.type(BASE.replace('three', 'mine'));
        agentWrites(BASE.replace('three\n', ''));
        await flush();
        mountedConflict().conflict.keepTheirs('5:0');
        expect(editor.getText()).toBe(BASE.replace('three\n', ''));
    });
});

describe('a save the machine refuses', () => {
    test('reads what the file holds now and asks per stretch, then saves over it', async () => {
        editor.type(BASE.replace('three', 'mine'));
        link.refuseNext = true;
        link.disk = { text: BASE.replace('three', 'theirs').replace('seven', 'agent-seven'), mtime: 7 };
        const saved = await drafts.save(MACHINE, PATH);
        await flush();

        expect(saved).toBe(false);
        expect(draft()).toMatchObject({ problem: { kind: 'stale' } });
        expect(draft().incoming).toMatchObject({ mtime: 7 });
        expect(lines(editor.getText())).toBe('one two mine four five six agent-seven');
        expect(rowIds()).toEqual(['7:0:yours', '7:0:theirs']);

        mountedConflict().conflict.keepYours('7:0');
        await flush();
        expect(link.writes.at(-1)).toEqual({ text: editor.getText(), expectedMtime: 7 });
        expect(draft()).toMatchObject({ problem: null });
    });

    test('the file only touched leaves nothing to decide', async () => {
        editor.type(BASE.replace('three', 'mine'));
        link.refuseNext = true;
        link.disk = { text: BASE, mtime: 7 };
        await drafts.save(MACHINE, PATH);
        await flush();
        expect(draft().problem).toBeNull();
        expect(draft().incoming).toBeUndefined();
        expect(draft().mtime).toBe(7);
    });
});

function mountedConflict(): { conflict: ReturnType<typeof mountConflictResolution>['conflict'] } {
    if (mounted === null) {
        throw new Error('not mounted');
    }
    return mounted;
}
