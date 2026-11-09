import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { FsReadResult, FsWriteResult } from '@ruimte/contracts';
import { bindDraftEditor, mountDraftEditor } from '@/files/draft-editor';
import { AUTOSAVE_DELAY_MS, type DraftLink, TextDrafts, useTextDrafts } from '@/state/text-drafts';
import { TransportError } from '@/transport-api/transport';

const MACHINE = 'm1';
const PATH = '/repo/a.ts';

// Fake timers leave setImmediate alone, so this drains every pending promise without letting a timer run.
function flush(): Promise<void> {
    return new Promise((resolve) => setImmediate(resolve));
}

function deferred<T>(): { promise: Promise<T>; resolve(value: T): void; reject(error: unknown): void } {
    let resolve!: (value: T) => void;
    let reject!: (error: unknown) => void;
    const promise = new Promise<T>((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

interface Write {
    path: string;
    text: string;
    expectedMtime: number;
    answer: ReturnType<typeof deferred<FsWriteResult>>;
}

/* A machine that answers every write and read by hand, so a test says exactly when and how each one settles. */
class FakeLink implements DraftLink {
    readonly writes: Write[] = [];
    disk: { text: string; mtime: number } = { text: 'one', mtime: 1 };
    reopened = 0;

    read(): Promise<FsReadResult> {
        return Promise.resolve({ kind: 'text', text: this.disk.text, encoding: 'utf-8', size: this.disk.text.length, mtime: this.disk.mtime });
    }

    write(path: string, text: string, expectedMtime: number): Promise<FsWriteResult> {
        const answer = deferred<FsWriteResult>();
        this.writes.push({ path, text, expectedMtime, answer });
        return answer.promise;
    }

    projectOpen(): Promise<void> {
        this.reopened += 1;
        return Promise.resolve();
    }

    async land(mtime: number): Promise<void> {
        const write = this.writes.at(-1)!;
        this.disk = { text: write.text, mtime };
        write.answer.resolve({ size: write.text.length, mtime });
        await flush();
    }

    async refuse(code: string): Promise<void> {
        this.writes.at(-1)!.answer.reject(new TransportError(code, `refused: ${code}`));
        await flush();
    }
}

let link: FakeLink;
let drafts: TextDrafts;
// The surface every test draws the file on, so a clean draft stays around to be looked at.
let releaseSurface: () => void;

function draft() {
    return drafts.draft(MACHINE, PATH);
}

beforeEach(() => {
    jest.useFakeTimers();
    useTextDrafts.setState({ rows: {} });
    link = new FakeLink();
    drafts = new TextDrafts(() => link);
    releaseSurface = drafts.hold(MACHINE, PATH);
    drafts.open(MACHINE, PATH, { text: 'one', mtime: 1 });
});

afterEach(() => {
    jest.useRealTimers();
});

describe('staged text', () => {
    const OTHER = '/repo/b.ts';

    test('waits for a save of a person, with or without a surface drawing the file', async () => {
        drafts.stage(MACHINE, OTHER, { text: 'two', mtime: 4 }, 'three');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3);
        await flush();
        expect(link.writes).toHaveLength(0);
        expect(drafts.draft(MACHINE, OTHER)).toMatchObject({ disk: 'two', text: 'three', mtime: 4 });
        expect(drafts.isUnsaved(MACHINE, OTHER)).toBe(true);

        const saving = drafts.save(MACHINE, OTHER);
        await flush();
        expect(link.writes.map(({ path, text, expectedMtime }) => ({ path, text, expectedMtime }))).toEqual([{ path: OTHER, text: 'three', expectedMtime: 4 }]);
        await link.land(5);
        expect(await saving).toBe(true);
        const release = drafts.hold(MACHINE, OTHER);
        drafts.stage(MACHINE, OTHER, { text: 'three', mtime: 5 }, 'four');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 3);
        await flush();
        expect(link.writes).toHaveLength(1);
        const heldSave = drafts.save(MACHINE, OTHER);
        await flush();
        expect(link.writes.at(-1)).toMatchObject({ path: OTHER, text: 'four', expectedMtime: 5 });
        await link.land(6);
        expect(await heldSave).toBe(true);
        release();
    });

    test('stops a save that was due when the staged text lands on a file that is being typed in', async () => {
        drafts.edit(MACHINE, PATH, 'one two');
        drafts.stage(MACHINE, PATH, { text: 'one', mtime: 1 }, 'one three');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
        await flush();
        expect(link.writes).toHaveLength(0);
        expect(draft()?.text).toBe('one three');
    });
});

describe('autosave', () => {
    test('saves once the typing has paused, over the mtime it read', async () => {
        drafts.edit(MACHINE, PATH, 'one two');
        jest.advanceTimersByTime(999);
        await flush();
        expect(link.writes).toHaveLength(0);
        expect(drafts.isUnsaved(MACHINE, PATH)).toBe(true);

        jest.advanceTimersByTime(1);
        await flush();
        expect(link.writes.map(({ text, expectedMtime }) => ({ text, expectedMtime }))).toEqual([{ text: 'one two', expectedMtime: 1 }]);
        await link.land(2);
        expect(draft()).toMatchObject({ disk: 'one two', text: 'one two', mtime: 2, saving: false, problem: null });
    });

    test('waits for a pause, not for the first keystroke', async () => {
        drafts.edit(MACHINE, PATH, 'one t');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100);
        drafts.edit(MACHINE, PATH, 'one tw');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS - 100);
        await flush();
        expect(link.writes).toHaveLength(0);
        jest.advanceTimersByTime(100);
        await flush();
        expect(link.writes.map((write) => write.text)).toEqual(['one tw']);
    });

    test('typing back to what is on disk leaves nothing to save', async () => {
        drafts.edit(MACHINE, PATH, 'one!');
        drafts.edit(MACHINE, PATH, 'one');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
        await flush();
        expect(link.writes).toHaveLength(0);
        expect(drafts.isUnsaved(MACHINE, PATH)).toBe(false);
    });

    test('never has two writes of one file out, and the second goes over the mtime of the first', async () => {
        drafts.edit(MACHINE, PATH, 'one two');
        const first = drafts.save(MACHINE, PATH);
        await flush();
        drafts.edit(MACHINE, PATH, 'one two three');
        const second = drafts.save(MACHINE, PATH);
        await flush();
        expect(link.writes).toHaveLength(1);

        await link.land(2);
        await flush();
        expect(link.writes.map(({ text, expectedMtime }) => ({ text, expectedMtime }))).toEqual([
            { text: 'one two', expectedMtime: 1 },
            { text: 'one two three', expectedMtime: 2 }
        ]);
        await link.land(3);
        expect(await first).toBe(true);
        expect(await second).toBe(true);
        expect(draft()).toMatchObject({ text: 'one two three', mtime: 3 });
    });
});

describe('a file that moved', () => {
    test('a refused save stops the autosave and keeps the draft', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        const saved = drafts.save(MACHINE, PATH);
        await flush();
        await link.refuse('stale');
        expect(await saved).toBe(false);
        expect(draft()).toMatchObject({ text: 'mine', problem: { kind: 'stale' } });

        drafts.edit(MACHINE, PATH, 'mine too');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 5);
        await flush();
        expect(link.writes).toHaveLength(1);
        expect(await drafts.save(MACHINE, PATH)).toBe(false);
    });

    test('overwrite writes the draft over the mtime the file has now', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        void drafts.save(MACHINE, PATH);
        await flush();
        await link.refuse('stale');
        link.disk = { text: 'theirs', mtime: 7 };

        const saved = drafts.overwrite(MACHINE, PATH);
        await flush();
        expect(link.writes.at(-1)).toMatchObject({ text: 'mine', expectedMtime: 7 });
        await link.land(8);
        expect(await saved).toBe(true);
        expect(draft()).toMatchObject({ disk: 'mine', text: 'mine', mtime: 8, problem: null });
    });

    test('reload takes what is on disk and drops the draft', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'theirs', mtime: 7 });
        link.disk = { text: 'theirs', mtime: 7 };
        await drafts.reload(MACHINE, PATH);
        expect(draft()).toMatchObject({ disk: 'theirs', text: 'theirs', mtime: 7, problem: null });
    });

    test('a read without unsaved changes is taken as it is', () => {
        drafts.received(MACHINE, PATH, { text: 'theirs', mtime: 7 });
        expect(draft()).toMatchObject({ disk: 'theirs', text: 'theirs', mtime: 7, problem: null });
    });

    test('a read that moved under unsaved changes asks before any save', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'theirs', mtime: 7 });
        expect(draft()).toMatchObject({ text: 'mine', disk: 'one', problem: { kind: 'changed' } });
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS * 5);
        await flush();
        expect(link.writes).toHaveLength(0);
    });

    test('a file only touched keeps the draft and saves over its new mtime', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'one', mtime: 5 });
        expect(draft()?.problem).toBeNull();
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
        await flush();
        expect(link.writes.at(-1)).toMatchObject({ text: 'mine', expectedMtime: 5 });
    });

    test('its own write coming back changes nothing, even while the write is still out', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        void drafts.save(MACHINE, PATH);
        await flush();
        drafts.received(MACHINE, PATH, { text: 'mine', mtime: 2 });
        await link.land(2);
        drafts.received(MACHINE, PATH, { text: 'mine', mtime: 2 });
        drafts.edit(MACHINE, PATH, 'mine again');
        drafts.received(MACHINE, PATH, { text: 'mine', mtime: 2 });
        expect(draft()).toMatchObject({ text: 'mine again', disk: 'mine', mtime: 2, problem: null });
    });

    test('a read from before the write landed is not taken for a change', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        void drafts.save(MACHINE, PATH);
        await flush();
        drafts.received(MACHINE, PATH, { text: 'one', mtime: 1 });
        await link.land(2);
        expect(draft()).toMatchObject({ text: 'mine', disk: 'mine', mtime: 2, problem: null });
    });
});

describe('a save the machine refuses', () => {
    test('outside the project right after a reconnect is tried once more once the project is open again', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        const saved = drafts.save(MACHINE, PATH);
        await flush();
        await link.refuse('outside-project');
        expect(link.reopened).toBe(1);
        expect(link.writes).toHaveLength(2);
        await link.land(2);
        expect(await saved).toBe(true);
        expect(draft()?.problem).toBeNull();
    });

    test('outside the project twice is said, and the draft stays', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        const saved = drafts.save(MACHINE, PATH);
        await flush();
        await link.refuse('outside-project');
        await link.refuse('outside-project');
        expect(await saved).toBe(false);
        expect(link.writes).toHaveLength(2);
        expect(draft()).toMatchObject({ text: 'mine', problem: { kind: 'error', message: 'refused: outside-project' } });
    });

    test('any other failure is said, and the next save may still go through', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        void drafts.save(MACHINE, PATH);
        await flush();
        await link.refuse('not-writable');
        expect(draft()).toMatchObject({ text: 'mine', problem: { kind: 'error', message: 'refused: not-writable' } });

        drafts.edit(MACHINE, PATH, 'mine!');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
        await flush();
        await link.land(2);
        expect(draft()).toMatchObject({ disk: 'mine!', problem: null });
    });
});

describe('surfaces', () => {
    test('a clean draft goes with the last surface, an unsaved one stays', () => {
        const releaseTab = drafts.hold(MACHINE, PATH);
        const releaseNode = drafts.hold(MACHINE, PATH);
        drafts.edit(MACHINE, PATH, 'mine');
        releaseSurface();
        releaseTab();
        releaseNode();
        expect(draft()?.text).toBe('mine');

        drafts.discard(MACHINE, PATH);
        expect(draft()).toBeUndefined();
        const first = drafts.hold(MACHINE, PATH);
        const last = drafts.hold(MACHINE, PATH);
        drafts.open(MACHINE, PATH, { text: 'clean', mtime: 2 });
        first();
        first();
        expect(draft()?.text).toBe('clean');
        last();
        last();
        expect(draft()).toBeUndefined();
    });

    test('two editors on one file type into one draft', async () => {
        const engine = new FakeEditorEngine();
        const element = {} as HTMLElement;
        const tab = engine.mount(element, { text: 'one', theme: 'light' });
        const node = engine.mount(element, { text: 'one', theme: 'light' });
        const unbindTab = bindDraftEditor(tab, drafts, MACHINE, PATH);
        bindDraftEditor(node, drafts, MACHINE, PATH);

        tab.type('one from the tab');
        expect(node.getText()).toBe('one from the tab');
        node.type('one from the node');
        expect(tab.getText()).toBe('one from the node');

        node.save();
        await flush();
        expect(link.writes.map((write) => write.text)).toEqual(['one from the node']);
        await link.land(2);

        unbindTab();
        node.type('later');
        expect(tab.getText()).toBe('one from the node');
    });

    test('an editor taken down with its node saves on the way out and leaves what did not save to the next one', async () => {
        const engine = new FakeEditorEngine();
        const target = { endpointId: MACHINE, path: PATH, disk: { text: 'one', mtime: 1 } };
        const culled = mountDraftEditor(engine, {} as HTMLElement, drafts, target, { theme: 'light', language: 'typescript' });
        expect(engine.last.path).toBe(PATH);
        engine.last.type('mine');

        culled.unmount();
        releaseSurface();
        await flush();
        expect(engine.editors[0]!.disposed).toBe(true);
        expect(link.writes.map((write) => write.text)).toEqual(['mine']);
        await link.refuse('io');
        expect(draft()?.text).toBe('mine');

        mountDraftEditor(engine, {} as HTMLElement, drafts, target, { theme: 'light' });
        expect(engine.last.getText()).toBe('mine');
    });

    test('a read-only editor still follows the file on disk', () => {
        const engine = new FakeEditorEngine();
        mountDraftEditor(
            engine,
            {} as HTMLElement,
            drafts,
            { endpointId: MACHINE, path: PATH, disk: { text: 'one', mtime: 1 } },
            { theme: 'light', readOnly: true }
        );
        drafts.received(MACHINE, PATH, { text: 'two', mtime: 2 });
        expect(engine.last.getText()).toBe('two');
    });

    test('a save empties lines of only whitespace, but not the one an editor has its caret on', async () => {
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one', theme: 'light' });
        bindDraftEditor(editor, drafts, MACHINE, PATH);
        editor.focus();
        editor.setText('a\n  \nb\n    ');
        editor.setCaret({ line: 3, character: 4 });
        drafts.edit(MACHINE, PATH, editor.getText());
        void drafts.save(MACHINE, PATH);
        await flush();
        expect(link.writes.at(-1)?.text).toBe('a\n\nb\n    ');
        expect(editor.getText()).toBe('a\n\nb\n    ');
    });

    test('a draft no editor holds is tidied whole', async () => {
        drafts.stage(MACHINE, PATH, { text: 'one', mtime: 1 }, 'x\n\t\ny');
        void drafts.save(MACHINE, PATH);
        await flush();
        expect(link.writes.at(-1)?.text).toBe('x\n\ny');
    });

    test('leaving the editor saves at once, and a reload reaches every editor', async () => {
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'one', theme: 'light' });
        bindDraftEditor(editor, drafts, MACHINE, PATH);
        editor.focus();
        editor.type('mine');
        editor.blur();
        await flush();
        expect(link.writes.map((write) => write.text)).toEqual(['mine']);
        await link.refuse('stale');

        link.disk = { text: 'theirs', mtime: 9 };
        await drafts.reload(MACHINE, PATH);
        expect(editor.getText()).toBe('theirs');
    });
});

describe('the version that moved under unsaved text', () => {
    test('a read that moved keeps its text next to the draft, over the version the draft started from', () => {
        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'theirs', mtime: 7 });
        expect(draft()).toMatchObject({ disk: 'one', mtime: 1, text: 'mine', incoming: { text: 'theirs', mtime: 7 }, problem: { kind: 'changed' } });

        drafts.received(MACHINE, PATH, { text: 'theirs again', mtime: 8 });
        expect(draft()?.incoming).toEqual({ text: 'theirs again', mtime: 8 });
    });

    test('resolving takes the incoming version as the disk, the merged text as the draft, and saves over it', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'theirs', mtime: 7 });

        const saved = drafts.resolveIncoming(MACHINE, PATH, 'merged');
        await flush();
        expect(draft()).toMatchObject({ disk: 'theirs', mtime: 7, text: 'merged', problem: null });
        expect(draft()?.incoming).toBeUndefined();
        expect(link.writes.at(-1)).toMatchObject({ text: 'merged', expectedMtime: 7 });
        await link.land(8);
        expect(await saved).toBe(true);
        expect(draft()).toMatchObject({ disk: 'merged', mtime: 8 });
    });

    test('a merge that came out as the incoming version has nothing left to save', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'theirs', mtime: 7 });
        expect(await drafts.resolveIncoming(MACHINE, PATH, 'theirs')).toBe(true);
        expect(link.writes).toHaveLength(0);
        expect(draft()).toMatchObject({ disk: 'theirs', text: 'theirs', problem: null });
    });

    test('without an incoming version there is nothing to resolve', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        expect(await drafts.resolveIncoming(MACHINE, PATH, 'merged')).toBe(false);
        expect(draft()?.text).toBe('mine');
    });

    test('a refused save reads the file, so the other side is known', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        const saved = drafts.save(MACHINE, PATH);
        await flush();
        link.disk = { text: 'theirs', mtime: 7 };
        await link.refuse('stale');
        expect(await saved).toBe(false);
        expect(draft()).toMatchObject({ problem: { kind: 'stale' }, incoming: { text: 'theirs', mtime: 7 } });
    });

    test('the file going back to where the draft started leaves nothing to decide', () => {
        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'theirs', mtime: 7 });
        drafts.received(MACHINE, PATH, { text: 'one', mtime: 8 });
        expect(draft()).toMatchObject({ mtime: 8, problem: null });
        expect(draft()?.incoming).toBeUndefined();
    });

    test('Reload, Overwrite and closing without saving let the incoming version go', async () => {
        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'theirs', mtime: 7 });
        link.disk = { text: 'theirs', mtime: 7 };
        await drafts.reload(MACHINE, PATH);
        expect(draft()?.incoming).toBeUndefined();

        drafts.edit(MACHINE, PATH, 'mine');
        drafts.received(MACHINE, PATH, { text: 'overwrite theirs', mtime: 8 });
        link.disk = { text: 'overwrite theirs', mtime: 8 };
        const overwritten = drafts.overwrite(MACHINE, PATH);
        await flush();
        expect(draft()?.incoming).toBeUndefined();
        expect(draft()?.saving).toBe(true);
        expect(link.writes.at(-1)).toMatchObject({ text: 'mine', expectedMtime: 8 });
        await link.land(9);
        expect(await overwritten).toBe(true);

        drafts.edit(MACHINE, PATH, 'mine again');
        drafts.received(MACHINE, PATH, { text: 'theirs 2', mtime: 10 });
        expect(draft()?.incoming).toEqual({ text: 'theirs 2', mtime: 10 });
        drafts.discard(MACHINE, PATH);
        expect(draft()?.incoming).toBeUndefined();
    });
});

describe('save participants', () => {
    test('saves again after a tidy brought the text back to what is on disk', async () => {
        const tidy = drafts.beforeSave(MACHINE, PATH, () => drafts.edit(MACHINE, PATH, 'one'));
        drafts.edit(MACHINE, PATH, 'one ');

        expect(await drafts.save(MACHINE, PATH)).toBe(true);
        expect(link.writes).toHaveLength(0);

        tidy();
        drafts.edit(MACHINE, PATH, 'one two');
        const saved = drafts.save(MACHINE, PATH);
        await flush();

        expect(link.writes.map((write) => write.text)).toEqual(['one two']);

        await link.land(2);

        expect(await saved).toBe(true);
    });

    test('awaits a participant before the preparers and the write, and writes what it left in the draft', async () => {
        const order: string[] = [];
        const release = deferred<void>();
        drafts.beforeSave(MACHINE, PATH, () => order.push('prepare'));
        drafts.participate(MACHINE, PATH, async () => {
            order.push('participant');
            await release.promise;
            drafts.edit(MACHINE, PATH, 'one fixed');
            order.push('participant done');
        });
        drafts.edit(MACHINE, PATH, 'one typed');
        const saved = drafts.save(MACHINE, PATH);
        await flush();

        expect(order).toEqual(['participant']);
        expect(link.writes).toHaveLength(0);

        release.resolve();
        await flush();

        expect(order).toEqual(['participant', 'participant done', 'prepare']);
        expect(link.writes.map((write) => write.text)).toEqual(['one fixed']);

        await link.land(2);

        expect(await saved).toBe(true);
    });

    test('has the draft marked as saving while the participant runs, before any write can settle', async () => {
        const release = deferred<void>();
        drafts.participate(MACHINE, PATH, () => release.promise);
        drafts.edit(MACHINE, PATH, 'one typed');
        const first = drafts.save(MACHINE, PATH);
        const second = drafts.save(MACHINE, PATH);
        release.resolve();
        await flush();

        expect(link.writes).toHaveLength(1);

        await link.land(2);
        await Promise.all([first, second]);

        expect(link.writes).toHaveLength(1);
        expect(draft()).toMatchObject({ saving: false, text: 'one typed', mtime: 2 });
    });

    test('skips the participant for a save that writes an edit of a server', async () => {
        let asked = 0;
        drafts.participate(MACHINE, PATH, async () => {
            asked += 1;
        });
        drafts.edit(MACHINE, PATH, 'one typed');
        void drafts.save(MACHINE, PATH, 'edit');
        await flush();

        expect(asked).toBe(0);
        expect(link.writes).toHaveLength(1);
    });

    test('runs only the first participant of a file, so two editors do not apply the edits twice', async () => {
        const asked: string[] = [];
        const offFirst = drafts.participate(MACHINE, PATH, async () => {
            asked.push('first');
        });
        drafts.participate(MACHINE, PATH, async () => {
            asked.push('second');
        });
        drafts.edit(MACHINE, PATH, 'one typed');
        void drafts.save(MACHINE, PATH);
        await flush();
        await link.land(2);
        drafts.edit(MACHINE, PATH, 'one typed more');
        offFirst();
        void drafts.save(MACHINE, PATH);
        await flush();

        expect(asked).toEqual(['first', 'second']);
    });

    test('still saves when a participant rejects', async () => {
        drafts.participate(MACHINE, PATH, () => Promise.reject(new Error('server went away')));
        drafts.edit(MACHINE, PATH, 'one typed');
        const saved = drafts.save(MACHINE, PATH);
        await flush();
        await link.land(2);

        expect(await saved).toBe(true);
        expect(link.writes.map((write) => write.text)).toEqual(['one typed']);
    });

    test('tells the participant why the save happens', async () => {
        const reasons: string[] = [];
        drafts.participate(MACHINE, PATH, async (reason) => {
            reasons.push(reason);
        });
        drafts.edit(MACHINE, PATH, 'one typed');
        jest.advanceTimersByTime(AUTOSAVE_DELAY_MS);
        await flush();
        await link.land(2);
        drafts.edit(MACHINE, PATH, 'one typed again');
        void drafts.save(MACHINE, PATH, 'focusOut');
        await flush();
        await link.land(3);
        drafts.edit(MACHINE, PATH, 'one typed once more');
        void drafts.save(MACHINE, PATH);
        await flush();

        expect(reasons).toEqual(['afterDelay', 'focusOut', 'manual']);
    });

    test('asks nothing for the follow-up save of text typed while a write was out', async () => {
        const reasons: string[] = [];
        drafts.participate(MACHINE, PATH, async (reason) => {
            reasons.push(reason);
        });
        drafts.edit(MACHINE, PATH, 'one typed');
        void drafts.save(MACHINE, PATH);
        await flush();
        drafts.edit(MACHINE, PATH, 'one typed more');
        await link.land(2);
        await flush();
        await link.land(3);

        expect(reasons).toEqual(['manual', 'afterDelay']);
    });

    test('lets a participant go with its removal', async () => {
        let asked = 0;
        const off = drafts.participate(MACHINE, PATH, async () => {
            asked += 1;
        });
        off();
        drafts.edit(MACHINE, PATH, 'one typed');
        void drafts.save(MACHINE, PATH);
        await flush();

        expect(asked).toBe(0);
    });
});
