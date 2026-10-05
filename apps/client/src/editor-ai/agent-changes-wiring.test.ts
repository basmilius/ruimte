import { afterEach, describe, expect, test } from 'bun:test';
import type { ProvenanceReadResult } from '@ruimte/contracts';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import { FakeLanguageTransport } from '@/language/fake-daemon';
import { endpointKey } from '@/state/keys';
import { useTextDrafts } from '@/state/text-drafts';
import { mountAgentChanges } from './agent-changes-wiring';

const TEXT = 'one\ntwo\nthree\n';
const FILE = { endpointId: 'm1', projectId: 'p1', path: '/work/app/score.ts' };
const KEY = endpointKey(FILE.endpointId, FILE.path);

async function flush(): Promise<void> {
    for (let turn = 0; turn < 20; turn++) {
        await Promise.resolve();
    }
}

function result(mtime: number, start: number, end: number): ProvenanceReadResult {
    return {
        mtime,
        lines: 3,
        runs: [{ id: 'r1', chatId: 'chat-a', turnId: 'turn-1', provider: 'claude', at: 1, promptExcerpt: '', start, end, review: 'pending', via: 'tool' }]
    };
}

function mount(answer: ProvenanceReadResult) {
    const transport = new FakeLanguageTransport();
    transport.answers.set('provenance.read', () => answer);
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
    useTextDrafts.setState({ rows: { [KEY]: { disk: TEXT, mtime: 1, text: TEXT, saving: false, problem: null } } });
    const mounted = mountAgentChanges(editor, transport, FILE, () => [{ kind: 'claude', name: 'Claude Code' } as never]);
    mounted.changes.configure({ mode: 'gutter', attribution: true });
    return { transport, editor, mounted };
}

afterEach(() => {
    useTextDrafts.setState({ rows: {} });
});

describe('the daemon and the editor', () => {
    test('opening the file asks for its runs and draws them', async () => {
        const { transport, editor } = mount(result(1, 2, 3));
        await flush();
        expect(transport.calls.filter((call) => call.type === 'provenance.read')).toHaveLength(1);
        expect(editor.attributionMarks).toHaveLength(1);
    });

    test('a change of this file asks again and a change of another file does not', async () => {
        const { transport, editor } = mount(result(1, 2, 3));
        await flush();
        transport.emit('provenance.changed', { projectId: 'p1', path: '/work/app/other.ts', chatId: 'chat-a', turnId: 'turn-1', live: true });
        await flush();
        expect(transport.calls.filter((call) => call.type === 'provenance.read')).toHaveLength(1);

        transport.emit('provenance.changed', { projectId: 'p1', path: FILE.path, chatId: 'chat-a', turnId: 'turn-1', live: true });
        await flush();
        expect(transport.calls.filter((call) => call.type === 'provenance.read')).toHaveLength(2);
        expect(editor.attributionMarks.map((mark) => [mark.startLine, mark.endLine])).toEqual([[2, 3]]);
        expect(editor.remoteCursors[0]!.name).toBe('Claude Code');
    });

    test('a new text on disk for the draft asks again, and unmounting clears what was drawn', async () => {
        const { transport, editor, mounted } = mount(result(2, 1, 1));
        await flush();
        const asked = transport.calls.length;

        useTextDrafts.setState({ rows: { [KEY]: { disk: TEXT, mtime: 2, text: TEXT, saving: false, problem: null } } });
        await flush();
        expect(transport.calls.length).toBe(asked + 1);
        expect(editor.attributionMarks).toHaveLength(1);

        mounted.unmount();
        expect(editor.attributionMarks).toEqual([]);
    });
});

describe('the review of a file', () => {
    test('Keep and Undo go to the machine for the run in this file, and the chat hears what was reverted', async () => {
        const transport = new FakeLanguageTransport();
        const answer = { ...result(1, 2, 2) };
        answer.runs = answer.runs.map((run) => ({ ...run, before: ['was two'] }));
        transport.answers.set('provenance.read', () => answer);
        transport.answers.set('provenance.review', (payload: { state: 'kept' | 'undone' }) => {
            answer.runs = answer.runs.map((run) => ({ ...run, review: payload.state }));
            return { updated: 1 };
        });
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
        useTextDrafts.setState({ rows: { [KEY]: { disk: TEXT, mtime: 1, text: TEXT, saving: false, problem: null } } });
        const offered: Array<[string, string]> = [];
        const mounted = mountAgentChanges(editor, transport, FILE, () => [], {
            offer: (chatId, text) => offered.push([chatId, text]),
            focusChat: () => undefined,
            chatExists: () => true,
            language: () => 'typescript',
            folder: () => '/work/app'
        });
        mounted.changes.configure({ mode: 'review', attribution: true });
        await flush();
        expect(editor.widgetsByOwner.get('review')?.map((row) => row.id)).toEqual(['r1']);

        mounted.review!.keep('r1');
        await flush();
        expect(transport.callsOf('provenance.review')[0]!.payload).toEqual({ projectId: 'p1', path: FILE.path, runIds: ['r1'], state: 'kept' });

        answer.runs = answer.runs.map((run) => ({ ...run, review: 'pending' as const }));
        mounted.changes.refresh();
        await flush();
        mounted.review!.undo('r1');
        await flush();
        expect(editor.getText()).toBe('one\nwas two\nthree\n');
        expect(transport.callsOf('provenance.review')[1]!.payload).toMatchObject({ state: 'undone' });
        expect(offered).toEqual([['chat-a', 'I reverted your change in score.ts:2.\n\n']]);

        mounted.unmount();
        expect(editor.widgetsByOwner.size).toBe(0);
    });
});

describe('the other side of a draft', () => {
    test('the runs are mapped onto the version that moved under the draft, so what merged in carries the agent bar', async () => {
        const transport = new FakeLanguageTransport();
        transport.answers.set('provenance.read', () => result(5, 2, 2));
        const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: TEXT, theme: 'light' });
        const incoming = 'one\nTWO\nthree\n';
        useTextDrafts.setState({
            rows: { [KEY]: { disk: TEXT, mtime: 1, text: TEXT, saving: false, problem: { kind: 'changed' }, incoming: { text: incoming, mtime: 5 } } }
        });
        const mounted = mountAgentChanges(editor, transport, FILE, () => []);
        mounted.changes.configure({ mode: 'gutter', attribution: true });
        await flush();
        editor.setText(incoming);
        await flush();
        expect(editor.attributionMarks.map((mark) => [mark.startLine, mark.endLine])).toEqual([[2, 2]]);
        mounted.unmount();
    });
});
