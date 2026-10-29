import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { rm } from 'node:fs/promises';
import type { ContextSource } from '@ruimte/contracts';
import { chatPrompt, verbsNote } from '../context/context-note.ts';
import { showNotices, NoticeNotes, unshownNotes, NoticeStore, type Notice } from '@adecore/agents/coordination';
import { deliverNotice, MESSAGE_WORDS } from '../context/notices.ts';
import { VisualStore } from '@adecore/agents/chat';
import { referenceNote, type Reference } from '../context/references.ts';
import type { FirstPrompt } from '../agents/pending-prompts.ts';
import { BRIEF_TITLE } from './chat-manager.ts';
import { ChatRecorder } from './chat-test-helpers.ts';
import { makeChatFixture, retire, LINKED } from './chat-manager.fixture.test.ts';

type ChatFixture = Awaited<ReturnType<typeof makeChatFixture>>;
let home: ChatFixture['home'];
let attachments: ChatFixture['attachments'];
let store: ChatFixture['store'];
let claude: ChatFixture['claude'];
let manager: ChatFixture['manager'];
let recorder: ChatFixture['recorder'];
let makeManager: ChatFixture['makeManager'];
let remake: ChatFixture['remake'];
let open: ChatFixture['open'];
beforeEach(async () => {
    ({ home, attachments, store, claude, manager, recorder, makeManager, open, remake } = await makeChatFixture());
});
afterEach(async () => {
    await retire(manager);
    await rm(home, { recursive: true, force: true });
});

test('a standalone chat passes its location to the Claude system prompt', async () => {
    manager = await remake(manager, { standalone: (id) => id === 'chat-view' });
    await open(manager, 'chat-view');
    await manager.send('chat-view', 'system?');
    await recorder.untilIdle();
    expect(recorder.ofKind('assistant')[0]?.text).toBe(verbsNote({ depth: 0, standalone: true }));
});

test('the system prompt names visuals while the machine has them on, and never to an inline edit', async () => {
    const visuals = new VisualStore(home, attachments);
    manager = await remake(manager, { visuals, visualReplies: () => true, inlineChat: (chatId) => chatId === 'chat-inline' });
    await open(manager, 'chat-shows');
    await manager.send('chat-shows', 'system?');
    await recorder.untilIdle();
    expect(recorder.ofKind('assistant')[0]?.text).toBe(verbsNote({ depth: 0, visuals: true }));
    expect(claude.started[0]!.argv.filter((arg) => arg.startsWith('--add-dir='))).toEqual([`--add-dir=${visuals.workspacePath('chat-shows')}`]);

    const inline = new ChatRecorder();
    manager.subscribe('c2', inline.sink());
    await manager.create({ chatId: 'chat-inline', cwd: home });
    manager.attach('chat-inline', 'c2');
    // The first prompt carries the inline edit's preamble, which the fake echoes instead.
    await manager.send('chat-inline', 'first');
    await inline.until(() => inline.ofKind('assistant').length === 1 && inline.info?.activeTurnId === null);
    await manager.send('chat-inline', 'system?');
    await inline.until(() => inline.ofKind('assistant').length === 2 && inline.info?.activeTurnId === null);
    expect(inline.ofKind('assistant')[1]?.text).toBe(verbsNote({ depth: 0 }));
    expect(claude.started[1]!.argv.some((arg) => arg.startsWith('--add-dir='))).toBe(false);
});

test('the system prompt names the verbs always and the linked sources by name when there are some', async () => {
    await open(manager, 'chat-sys');
    await manager.send('chat-sys', 'system?');
    await recorder.untilIdle();
    expect(recorder.ofKind('assistant')[0]?.text).toBe(verbsNote({ depth: 0 }));

    manager = await remake(manager, { contextSources: () => LINKED, depthOf: () => 2 });
    const linked = new ChatRecorder();
    manager.subscribe('c2', linked.sink());
    await manager.create({ chatId: 'chat-sys-2', cwd: home });
    manager.attach('chat-sys-2', 'c2');
    await manager.send('chat-sys-2', 'system?');
    await linked.until(() => linked.ofKind('assistant').length === 1 && linked.info?.activeTurnId === null);
    // The same sentence a Codex thread is started with, asserted there against the same call.
    expect(linked.ofKind('assistant')[0]?.text).toBe(chatPrompt({ sources: LINKED, depth: 2 }));
    expect(linked.ofKind('assistant')[0]?.text).toContain('"iPhone 18 Pro Max" (device)');
});

test('a link made between turns is put in front of the next prompt, once, as a note', async () => {
    let sources: ContextSource[] = [];
    manager = await remake(manager, { contextSources: () => sources });
    await open(manager, 'chat-ctx');

    await manager.send('chat-ctx', 'first');
    await recorder.untilIdle();
    sources = [{ id: 'term-1', kind: 'terminal', title: 'dev server' }];
    await manager.send('chat-ctx', 'second');
    await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
    await manager.send('chat-ctx', 'third');
    await recorder.until(() => recorder.info?.usage.turns === 3 && recorder.idle);

    const notes = recorder.ofKind('note');
    expect(notes).toHaveLength(1);
    expect(notes[0]).toMatchObject({ level: 'info', turnId: recorder.ofKind('turn')[1]?.turnId });
    expect(notes[0]?.text).toContain('Added: "dev server" (terminal)');
    // The fake echoes its prompt, so the reply shows what the CLI was given.
    const replies = recorder.ofKind('assistant').map((item) => item.text);
    expect(replies[0]).toBe('echo: first');
    expect(replies[1]).toBe(`echo: ${notes[0]?.text}\n\nsecond`);
    expect(replies[2]).toBe('echo: third');
    expect(recorder.ofKind('user').map((item) => item.text)).toEqual(['first', 'second', 'third']);
});

test('a chat of a design hears once, at its next prompt, that the folder of its design moved', async () => {
    let folder = '/repo/.ruimte/private/designs/onboarding';
    manager = await remake(manager, { design: () => ({ folder, onCanvas: false }) });
    await open(manager, 'chat-design');

    await manager.send('chat-design', 'first');
    await recorder.untilIdle();
    folder = '/repo/.ruimte/designs/onboarding';
    await manager.send('chat-design', 'second');
    await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
    await manager.send('chat-design', 'third');
    await recorder.until(() => recorder.info?.usage.turns === 3 && recorder.idle);

    const notes = recorder.ofKind('note').map((item) => item.text);
    expect(notes).toEqual([
        'Ruimte: the pages of your design now live in `/repo/.ruimte/designs/onboarding`. Read and write them there from now on, never in `/repo/.ruimte/private/designs/onboarding`.'
    ]);
    // The fake echoes its prompt, so the reply shows what the CLI was given.
    const replies = recorder.ofKind('assistant').map((item) => item.text);
    expect(replies[1]).toBe(`echo: ${notes[0]}\n\nsecond`);
    expect(replies[2]).toBe('echo: third');
});

test('every turn that ends is told, so a design folder that moved during it takes in what the turn wrote', async () => {
    const ended: string[] = [];
    manager = await remake(manager, { turnEnded: (chatId) => ended.push(chatId) });
    await open(manager, 'chat-turns');

    await manager.send('chat-turns', 'first');
    await recorder.untilIdle();
    expect(ended.length).toBeGreaterThan(0);
    expect(new Set(ended)).toEqual(new Set(['chat-turns']));

    const afterFirst = ended.length;
    await manager.send('chat-turns', 'second');
    await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
    expect(ended.length).toBeGreaterThan(afterFirst);
});

test('a chat attached with @ and a view with # go to the CLI as the commands that read them, and to the thread as their ids', async () => {
    const known: Record<string, Reference> = {
        'chat-earlier': { id: 'chat-earlier', kind: 'chat', name: 'Auth rewrite', canvas: null, sources: [] },
        sketch: { id: 'sketch', kind: 'drawing', name: 'Sketch', canvas: null, sources: [] }
    };
    manager = await remake(manager, { reference: (chatId, id) => (chatId === 'chat-ref' ? (known[id] ?? null) : null) });
    await open(manager, 'chat-ref');

    // A view in `chats` is no chat its chips could draw, so only `references` carries it.
    await manager.send('chat-ref', 'carry on from #Sketch', { chats: ['chat-earlier', 'chat-elsewhere', 'sketch'], references: ['sketch', 'gone'] });
    await recorder.untilIdle();

    expect(recorder.ofKind('user')[0]).toMatchObject({ text: 'carry on from #Sketch', chats: ['chat-earlier'], references: ['sketch'] });
    // The fake echoes its prompt, so the reply shows what the CLI was given.
    expect(recorder.ofKind('assistant')[0]?.text).toBe(`echo: ${referenceNote([known['chat-earlier']!, known.sketch!])}\n\ncarry on from #Sketch`);
    // Nothing in the thread repeats it: the row draws the chip.
    expect(recorder.ofKind('note')).toEqual([]);
});

describe('the first prompt of an agent node', () => {
    const withPrompt = (prompt: string | null, brief?: string) => {
        let left: FirstPrompt | null = prompt === null ? null : { prompt, ...(brief === undefined ? {} : { brief }) };
        const options = () => ({
            firstPrompt: async () => {
                const value = left;
                left = null;
                return value;
            }
        });
        return { options, left: () => left };
    };

    const settledIn = (chatId: string) => (): boolean => manager.get(chatId)?.info.activeTurnId === null && manager.get(chatId)?.info.running === true;

    const threadOf = (chatId: string) => manager.get(chatId)!.thread.list();

    test('becomes the first message of the thread, so the person reads it as one', async () => {
        const held = withPrompt('start on the parser');
        manager = await remake(manager, held.options());

        const info = await manager.create({ chatId: 'chat-p', cwd: home });
        // The prompt is in the thread before create answers, so an attach right after it shows the turn.
        const items = manager.attach('chat-p', 'c1').items;
        expect(items.filter((item) => item.kind === 'user').map((item) => item.kind === 'user' && item.text)).toEqual(['start on the parser']);
        expect(info.chatId).toBe('chat-p');
        await recorder.until(settledIn('chat-p'));
        expect(
            threadOf('chat-p')
                .filter((item) => item.kind === 'assistant')
                .map((item) => item.kind === 'assistant' && item.text)
        ).toEqual(['echo: start on the parser']);
        expect(held.left()).toBeNull();
    });

    test('carries what a person picked in it, as a message sent with those chips would', async () => {
        const sketch: Reference = { id: 'sketch', kind: 'drawing', name: 'Sketch', canvas: null, sources: [] };
        let left: FirstPrompt | null = { prompt: 'use $report on #Sketch', picked: { skills: ['report'], references: ['sketch'] } };
        manager = await remake(manager, {
            reference: (chatId, id) => (chatId === 'chat-pick' && id === 'sketch' ? sketch : null),
            firstPrompt: async () => {
                const value = left;
                left = null;
                return value;
            }
        });
        await open(manager, 'chat-pick');
        await recorder.until(settledIn('chat-pick'));

        expect(threadOf('chat-pick').find((item) => item.kind === 'user')).toMatchObject({
            text: 'use $report on #Sketch',
            skills: ['report'],
            references: ['sketch']
        });
    });

    test('its brief is heard on the first turn and folds in the thread under the title, never in the message', async () => {
        manager = await remake(manager, withPrompt('summarize main', 'publish it to Output').options());
        await open(manager, 'chat-b');
        await recorder.until(settledIn('chat-b'));
        await manager.send('chat-b', 'and again');
        await recorder.until(() => manager.get('chat-b')?.info.usage.turns === 2 && settledIn('chat-b')());

        const thread = threadOf('chat-b');
        expect(thread.filter((item) => item.kind === 'user').map((item) => item.kind === 'user' && item.text)).toEqual(['summarize main', 'and again']);
        const notes = thread.filter((item) => item.kind === 'note');
        expect(notes.map((item) => item.kind === 'note' && item.text)).toEqual([`${BRIEF_TITLE}\npublish it to Output`]);
        expect(notes[0]?.turnId).toBe(thread.find((item) => item.kind === 'turn')!.turnId);
        // The fake echoes its prompt: the first turn heard the brief, the second only the person.
        expect(thread.filter((item) => item.kind === 'assistant').map((item) => item.kind === 'assistant' && item.text)).toEqual([
            `echo: ${BRIEF_TITLE}\npublish it to Output\n\nsummarize main`,
            'echo: and again'
        ]);
    });

    test('a wake with a brief hears it on that turn only, and a refused wake leaves it for nobody', async () => {
        manager = await remake(manager, withPrompt('start').options());
        await open(manager, 'chat-w');
        await recorder.until(settledIn('chat-w'));
        const session = manager.get('chat-w')!;

        const woke = manager.withBrief('chat-w', 'the brief', () => session.wake({ text: 'run again', label: 'Morning', taskIds: [] }));
        expect(woke).not.toBeNull();
        // In a turn, so this wake is refused, and its brief must not reach the next prompt.
        expect(manager.withBrief('chat-w', 'a refused brief', () => session.wake({ text: 'too soon', label: 'Morning', taskIds: [] }))).toBeNull();
        await recorder.until(() => session.info.usage.turns === 2 && settledIn('chat-w')());
        await manager.send('chat-w', 'by hand');
        await recorder.until(() => session.info.usage.turns === 3 && settledIn('chat-w')());

        const thread = threadOf('chat-w');
        expect(thread.filter((item) => item.kind === 'note').map((item) => item.kind === 'note' && item.text)).toEqual([`${BRIEF_TITLE}\nthe brief`]);
        expect(thread.filter((item) => item.kind === 'assistant').map((item) => item.kind === 'assistant' && item.text)).toEqual([
            'echo: start',
            `echo: ${BRIEF_TITLE}\nthe brief\n\nrun again`,
            'echo: by hand'
        ]);
    });

    test('a second create of the same chat sends nothing again', async () => {
        const held = withPrompt('only once');
        manager = await remake(manager, held.options());

        const userTexts = () =>
            threadOf('chat-p')
                .filter((item) => item.kind === 'user')
                .map((item) => item.text);
        await open(manager, 'chat-p');
        await recorder.until(settledIn('chat-p'));
        expect(userTexts()).toEqual(['only once']);

        // The client of a second window mounts the same node; the prompt is gone, so nothing is sent.
        await manager.create({ chatId: 'chat-p', cwd: home });
        expect(userTexts()).toEqual(['only once']);
        expect(held.left()).toBeNull();
        expect(claude.started).toHaveLength(1);
    });

    test('two creates at once, the machine starting the node and a client mounting it, send it once to one chat', async () => {
        const held = withPrompt('only once');
        manager = await remake(manager, held.options());

        const [started, mounted] = await Promise.all([manager.create({ chatId: 'chat-r', cwd: home }), manager.create({ chatId: 'chat-r', cwd: home })]);
        expect(mounted).toBe(started);
        // The mount waited for the whole create, so what it attaches to already carries the prompt.
        expect(
            manager
                .attach('chat-r', 'c1')
                .items.filter((item) => item.kind === 'user')
                .map((item) => item.kind === 'user' && item.text)
        ).toEqual(['only once']);
        await recorder.until(settledIn('chat-r'));
        expect(claude.started).toHaveLength(1);
    });

    test('a kill that arrives while the chat is being made ends the chat that was made', async () => {
        manager = await remake(manager, withPrompt('go').options());
        const creating = manager.create({ chatId: 'chat-s', cwd: home });
        const killed = manager.kill('chat-s');
        await creating;
        await killed;
        expect(manager.get('chat-s')).toBeUndefined();
    });

    test('without a prompt, create still spawns nothing', async () => {
        manager = await remake(manager, withPrompt(null).options());
        await manager.create({ chatId: 'chat-q', cwd: home });
        expect(manager.get('chat-q')?.running).toBe(false);
        expect(claude.started).toHaveLength(0);
    });
});

describe('a message another node left', () => {
    let notices: NoticeStore;

    const noticeOptions = () => ({
        messageNotes: (chatId: string) => new NoticeNotes(notices, chatId, MESSAGE_WORDS),
        unshownMessages: (chatId: string) => unshownNotes(notices, chatId, MESSAGE_WORDS)
    });

    const notify = async (targetId: string, text: string): Promise<void> => {
        const notice: Omit<Notice, 'createdAt'> = { projectId: 'project-1', targetId, from: 'term-1', fromTitle: 'dev server', text };
        await deliverNotice(
            notices,
            {
                terminal: () => null,
                // No outbox in these tests, so the message waits for the turn the test sends itself.
                chat: async (id) => (manager.get(id) === undefined ? 'none' : 'running'),
                wokenBy: () => []
            },
            notice
        );
        await showNotices(
            notices,
            { has: (id) => manager.hasStored(id), note: (id, line, message) => manager.addNote(id, 'info', line, message) },
            MESSAGE_WORDS,
            targetId
        );
    };

    const heard = 'Ruimte: node term-1 ("dev server") sent you a message: the build is green';
    const read = 'dev server sent a message: the build is green';

    beforeEach(async () => {
        notices = new NoticeStore(home);
        manager = await remake(manager, noticeOptions());
    });

    test('lands in the thread of a running chat at once, and in front of its next prompt once', async () => {
        await open(manager, 'chat-msg');
        await manager.send('chat-msg', 'first');
        await recorder.untilIdle();

        await notify('chat-msg', 'the build is green');
        await recorder.until(() => recorder.ofKind('note').length === 1);
        // Outside any turn, since nothing the model did put it there.
        expect(recorder.ofKind('note')[0]).toMatchObject({
            level: 'info',
            turnId: null,
            text: read,
            message: { from: 'term-1', title: 'dev server', text: 'the build is green' }
        });

        await manager.send('chat-msg', 'second');
        await recorder.until(() => recorder.info?.usage.turns === 2 && recorder.idle);
        await manager.send('chat-msg', 'third');
        await recorder.until(() => recorder.info?.usage.turns === 3 && recorder.idle);

        expect(recorder.ofKind('assistant').map((item) => item.text)).toEqual(['echo: first', `echo: ${heard}\n\nsecond`, 'echo: third']);
        /* One line for a person, written when the message landed. The turn that carried it to the
           model adds none of its own, since its preamble only repeats what the thread already says. */
        expect(recorder.ofKind('note')).toHaveLength(1);
    });

    test('waits for a chat nobody has started, and is in the thread before its first prompt', async () => {
        await notify('chat-cold', 'the build is green');
        // Nothing holds that id yet, so nothing was shown and nothing was taken.
        expect(notices.waiting('chat-cold')).toHaveLength(1);

        await manager.create({ chatId: 'chat-cold', cwd: home });
        expect(manager.attach('chat-cold', 'c1').items).toEqual([
            expect.objectContaining({
                kind: 'note',
                level: 'info',
                turnId: null,
                text: read,
                message: { from: 'term-1', title: 'dev server', text: 'the build is green' }
            })
        ]);

        await manager.send('chat-cold', 'what happened');
        await recorder.untilIdle();
        expect(recorder.ofKind('assistant')[0]?.text).toBe(`echo: ${heard}\n\nwhat happened`);
    });

    test('is in the thread once after a restart, whether or not the model heard it yet', async () => {
        await open(manager, 'chat-again');
        await notify('chat-again', 'the build is green');
        await store.written('chat-again', (record) => record.items.some((item) => item.kind === 'note'));

        await retire(manager);
        notices = new NoticeStore(home);
        await notices.load();
        manager = makeManager(noticeOptions());
        recorder = new ChatRecorder();
        manager.subscribe('c1', recorder.sink());

        await manager.create({ chatId: 'chat-again', cwd: home });
        expect(manager.attach('chat-again', 'c1').items.filter((item) => item.kind === 'note')).toEqual([expect.objectContaining({ text: read })]);
        // And the model, which had not heard it when the daemon went down, still hears it exactly once.
        await manager.send('chat-again', 'what happened');
        await recorder.untilIdle();
        expect(recorder.ofKind('assistant')[0]?.text).toBe(`echo: ${heard}\n\nwhat happened`);
    });
});
