import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatItem, ChatNoteItem, ChatTurnItem, ProjectCanvasView, ProjectContent } from '@ruimte/contracts';
import { ManualClock } from '../outbox/manual-clock.ts';
import { ProjectStore } from '../projects/project-store.ts';
import { bootTestDaemon, type TestDaemon } from '../tasks/test-daemon.ts';
import { claudeProjectSlug } from '@ruimte/agents/chat/claude-transcript';
import { SUMMARY_MAX_BYTES, summaryNoteId, summaryPrompt, summaryTexts } from './summary.ts';

const content = (): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        {
            kind: 'canvas',
            id: 'main',
            name: 'Canvas',
            nodes: [{ id: 'chat-lead', kind: 'chat', title: 'Lexer', x: 0, y: 0, w: 560, h: 640, provider: 'claude', providerFixed: true }],
            texts: [],
            edges: [],
            layouts: []
        }
    ]
});

const turnsOf = (items: readonly ChatItem[]): ChatTurnItem[] => items.filter((item): item is ChatTurnItem => item.kind === 'turn');
const summaryNotes = (items: readonly ChatItem[]): ChatNoteItem[] =>
    items.filter((item): item is ChatNoteItem => item.kind === 'note' && item.from !== undefined);
const assistantTexts = (items: readonly ChatItem[]): string[] => items.flatMap((item) => (item.kind === 'assistant' ? [item.text] : []));

describe('a fork summarizing for its original', () => {
    let root: string;
    let home: string;
    let folder: string;
    let store: ProjectStore;
    let projectId: string;
    let daemon: TestDaemon;

    const boot = async (): Promise<void> => {
        daemon = await bootTestDaemon({ home, store, clock: new ManualClock() });
    };

    beforeEach(async () => {
        root = await mkdtemp(join(tmpdir(), 'ruimte-summary-'));
        home = join(root, 'home');
        folder = join(root, 'repo');
        await mkdir(folder, { recursive: true });
        store = new ProjectStore(home);
        const opened = await store.openProject({ folder });
        projectId = opened.summary.projectId;
        await store.save(projectId, opened.document.rev, content());
        store.release(projectId);
        await boot();
    });

    afterEach(async () => {
        await daemon.stop();
        store.closeAll();
        await rm(root, { recursive: true, force: true });
    });

    const items = (chatId: string): ChatItem[] => daemon.chats.get(chatId)?.thread.list() ?? [];

    const say = async (chatId: string, text: string): Promise<void> => {
        const before = turnsOf(items(chatId)).length;
        await daemon.chats.send(chatId, text);
        await daemon.until(() => daemon.chats.get(chatId)?.info.activeTurnId === null && turnsOf(items(chatId)).length === before + 1);
    };

    /* An original of two turns and a fork after its first, with the transcript Claude Code would have written. */
    const forked = async (): Promise<string> => {
        await daemon.chats.create({ chatId: 'chat-lead', provider: 'claude', cwd: folder });
        await say('chat-lead', 'alpha');
        await say('chat-lead', 'bravo');
        const lead = daemon.chats.get('chat-lead')!;
        const sessionId = lead.info.agentSessionId!;
        const lines = turnsOf(lead.thread.list()).flatMap((turn, index) => [
            { type: 'user', uuid: `prompt-${index}`, isSidechain: false, sessionId, message: { role: 'user', content: `turn ${index}` } },
            { type: 'assistant', uuid: turn.native!.lastUuid, isSidechain: false, sessionId, message: { content: [{ type: 'text', text: 'echo' }] } }
        ]);
        const dir = join(daemon.chats.claudeProjectsDir, claudeProjectSlug(folder));
        await mkdir(dir, { recursive: true });
        await writeFile(join(dir, `${sessionId}.jsonl`), lines.map((entry) => JSON.stringify(entry)).join('\n'));
        const answer = await daemon.request('chat.fork', { chatId: 'chat-lead', turnId: turnsOf(lead.thread.list())[0]!.id });
        const { nodeId } = (answer as { result: { nodeId: string } }).result;
        await daemon.chats.create({ chatId: nodeId });
        await say(nodeId, 'found it');
        return nodeId;
    };

    /* Asks for the summary and waits until the fork's turn for it ended. */
    const summarize = async (forkId: string): Promise<ChatTurnItem> => {
        const answer = await daemon.request('chat.summarize', { chatId: forkId });
        expect(answer).toMatchObject({ ok: true });
        const { turnId } = (answer as { result: { turnId: string } }).result;
        await daemon.until(() => turnsOf(items(forkId)).some((turn) => turn.id === turnId && turn.state === 'done'));
        return turnsOf(items(forkId)).find((turn) => turn.id === turnId)!;
    };

    test('the fork writes it in a turn of its own, and the original gets one note and one preamble for its next prompt', async () => {
        daemon.worker.start();
        const forkId = await forked();
        const turn = await summarize(forkId);
        expect(turn).toMatchObject({ origin: 'agent', summaryFor: 'chat-lead', label: 'Summary for Lexer' });
        const answer = assistantTexts(items(forkId)).at(-1)!;
        expect(answer).toContain(summaryPrompt({ id: 'chat-lead', kind: 'node' }, 1));

        await daemon.until(() => summaryNotes(items('chat-lead')).length === 1);
        await daemon.worker.settled();
        const [note] = summaryNotes(items('chat-lead'));
        expect(note).toMatchObject({ id: summaryNoteId(turn.id), from: forkId, level: 'info', turnId: null });
        expect(note!.text).toStartWith(`Summary from fork Lexer (fork) (node ${forkId})\n\n${answer}`);
        expect(daemon.chats.get('chat-lead')!.preambles).toHaveLength(1);

        await say('chat-lead', 'go on');
        const reply = assistantTexts(items('chat-lead')).at(-1)!;
        expect(reply).toContain(`Ruimte: a fork of this conversation, node ${forkId} ("Lexer (fork)"), forked after your turn 1, reports what it found:`);
        expect(reply).toEndWith('go on');
        await say('chat-lead', 'and then');
        expect(assistantTexts(items('chat-lead')).at(-1)).toBe('echo: and then');

        // The line back from the fork, once, however often it reports.
        const edges = async () => ((await store.read(projectId)).views[0] as ProjectCanvasView).edges;
        expect((await edges()).filter((edge) => edge.from === forkId && edge.to === 'chat-lead')).toHaveLength(1);
        await summarize(forkId);
        await daemon.until(() => summaryNotes(items('chat-lead')).length === 2);
        await daemon.worker.settled();
        expect((await edges()).filter((edge) => edge.from === forkId && edge.to === 'chat-lead')).toHaveLength(1);
    });

    test('an original in a turn gets the note at once and the preamble with the prompt after it', async () => {
        daemon.worker.start();
        const forkId = await forked();
        await daemon.chats.send('chat-lead', 'slow');
        await daemon.until(() => daemon.chats.get('chat-lead')?.info.activeTurnId !== null);
        await summarize(forkId);
        await daemon.until(() => summaryNotes(items('chat-lead')).length === 1);
        expect(daemon.chats.get('chat-lead')!.info.activeTurnId).not.toBeNull();

        await daemon.chats.cancel('chat-lead');
        await daemon.until(() => daemon.chats.get('chat-lead')?.info.activeTurnId === null);
        await say('chat-lead', 'go on');
        expect(assistantTexts(items('chat-lead')).at(-1)).toContain('reports what it found');
    });

    test('a restart between the fork settling and the delivery loses nothing and delivers nothing twice', async () => {
        const forkId = await forked();
        const turn = await summarize(forkId);
        await daemon.until(() => daemon.outbox.list().some((entry) => entry.kind === 'deliver-summary'));
        expect(summaryNotes(items('chat-lead'))).toHaveLength(0);
        const [owed] = daemon.outbox.list();

        await daemon.stop();
        await boot();
        daemon.worker.start();
        await daemon.worker.settled();
        await daemon.chats.create({ chatId: 'chat-lead' });
        expect(summaryNotes(items('chat-lead'))).toHaveLength(1);

        // The same entry once more, as a crash after the note and before the entry went would leave it.
        await daemon.worker.enqueue(projectId, 'chat-lead', {
            kind: 'deliver-summary',
            payload: owed!.kind === 'deliver-summary' ? owed!.payload : { forkId, turnId: turn.id, text: '' }
        });
        await daemon.worker.settled();
        expect(summaryNotes(items('chat-lead'))).toHaveLength(1);
        expect(daemon.chats.get('chat-lead')!.preambles).toHaveLength(1);
    });

    test('a chat that is no fork is refused, and so is a fork whose original left the project', async () => {
        const forkId = await forked();
        expect(await daemon.request('chat.summarize', { chatId: 'chat-lead' })).toMatchObject({ ok: false, error: { code: 'not-a-fork' } });
        await store.mutate(projectId, (current) => ({
            content: {
                ...current,
                views: current.views.map((view) =>
                    view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => node.id !== 'chat-lead'), edges: [] } : view
                )
            },
            result: null
        }));
        expect(await daemon.request('chat.summarize', { chatId: forkId })).toMatchObject({ ok: false, error: { code: 'original-gone' } });
    });
});

describe('summaryTexts', () => {
    test('a summary over the cap is cut on a whole character and points at the fork for the rest', () => {
        const long = `${'a'.repeat(SUMMARY_MAX_BYTES - 1)}é and more`;
        const { note, preamble } = summaryTexts(long, { id: 'chat-fork', title: 'Lexer (fork)', kind: 'view' }, null);
        expect(note).toStartWith('Summary from fork Lexer (fork) (view chat-fork)');
        expect(note).toContain(`${'a'.repeat(SUMMARY_MAX_BYTES - 1)}\n\n[The summary was cut at 8 KiB; ruimte-context read chat-fork shows the whole fork.]`);
        expect(note).not.toContain('and more');
        expect(preamble).toStartWith('Ruimte: a fork of this conversation, view chat-fork ("Lexer (fork)"), forked, reports what it found:');
        expect(preamble).toEndWith('(The whole fork is readable with ruimte-context read chat-fork.)');
    });
});
