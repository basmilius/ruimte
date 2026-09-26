import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatAttachResult, ChatEvent, Task } from '@ruimte/contracts';
import { ProviderRegistry } from '../providers/registry.ts';
import { AttachmentStore } from './attachment-store.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatStore } from './chat-store.ts';
import { COMPACT_ABOVE_BYTES } from './chat-log.ts';
import { ChatRecorder, RecordingStore } from './chat-test-helpers.ts';
import { fakeClaude } from '@ruimte/agents/chat/fake-claude';
import { inProcess, type InProcessCli } from '@ruimte/agents/chat/fake-cli';
import { ChatThread } from '@ruimte/agents/chat/thread';

let home: string;
let attachments: AttachmentStore;
let claude: InProcessCli;
let managers: ChatManager[];

const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });

/* One run of the daemon's chats over the same home, with every event it numbered. */
const boot = (extra: Partial<ConstructorParameters<typeof ChatManager>[0]> = {}) => {
    const manager = new ChatManager({
        providers,
        store: new ChatStore(home, attachments),
        attachments,
        spawn: claude.spawn,
        env: { PATH: process.env.PATH, HOME: home },
        ...extra
    });
    managers.push(manager);
    const recorder = new ChatRecorder();
    manager.subscribe('watcher', recorder.sink());
    const numbered: Array<{ seq: number; event: ChatEvent }> = [];
    manager.observe((event) => {
        if (event.event === 'chat.event' && event.payload.seq !== undefined) {
            numbered.push({ seq: event.payload.seq, event: event.payload.event });
        }
    });
    return { manager, recorder, numbered };
};

/* What a client holds after an attach and the events it applied since; the daemon's own thread is the model of it. */
const mirrorOf = (result: ChatAttachResult): ChatThread => new ChatThread(result.info, result.items);

const idle = (recorder: ChatRecorder) => (): boolean => recorder.info?.status === 'idle' && recorder.info.activeTurnId === null && recorder.info.running;

beforeEach(async () => {
    home = await mkdtemp(join(tmpdir(), 'ruimte-chat-seq-'));
    attachments = new AttachmentStore(home);
    claude = inProcess(fakeClaude);
    managers = [];
});

afterEach(async () => {
    for (const manager of managers) {
        await manager.shutdown();
        for (const info of manager.list()) {
            manager.get(info.chatId)?.dispose();
        }
    }
    await rm(home, { recursive: true, force: true });
});

describe('the stream of a chat', () => {
    test('a client that comes back with any seq it saw ends with the thread a fresh attach hands out', async () => {
        const { manager, recorder, numbered } = boot();
        await manager.create({ chatId: 'chat', cwd: home });
        const start = manager.attach('chat', 'watcher');
        expect(start.seq).toBe(0);
        await manager.send('chat', 'hello');
        await recorder.until(idle(recorder));
        await manager.send('chat', 'run: ls');
        await recorder.until(() => idle(recorder)() && recorder.ofKind('turn').length === 2);

        const fresh = manager.attach('chat', 'fresh');
        expect(fresh.seq).toBe(numbered.at(-1)!.seq);
        expect(numbered.map((line) => line.seq)).toEqual(numbered.map((_, i) => i + 1));
        for (let since = 0; since <= fresh.seq!; since++) {
            // The client as it stood at `since`, the thread it attached to with every event up to there applied.
            const mirror = mirrorOf(start);
            for (const line of numbered.slice(0, since)) {
                mirror.apply(line.event);
            }
            const back = manager.attach('chat', `client-${since}`, undefined, since);
            expect(back.items).toEqual([]);
            expect(back.events).toEqual(numbered.slice(since).map((line) => line.event));
            for (const event of back.events!) {
                mirror.apply(event);
            }
            expect(mirror.snapshot()).toEqual({ info: fresh.info, items: fresh.items });
        }
    });

    test('a seq from before a clear gets the whole thread', async () => {
        const { manager, recorder } = boot();
        await manager.create({ chatId: 'chat', cwd: home });
        manager.attach('chat', 'watcher');
        await manager.send('chat', 'hello');
        await recorder.until(idle(recorder));
        const before = manager.attach('chat', 'client').seq!;
        await manager.clear('chat');
        await manager.send('chat', 'again');
        await recorder.until(() => idle(recorder)() && recorder.ofKind('turn').length === 1);

        const back = manager.attach('chat', 'client', undefined, before);
        expect(back.events).toBeUndefined();
        expect(back.items.filter((item) => item.kind === 'user').map((item) => (item.kind === 'user' ? item.text : ''))).toEqual(['again']);
        expect(back.seq).toBeGreaterThan(before);
    });

    test('cleared task rows stay gone after updates and restarts while new tasks still appear', async () => {
        const tasks: Task[] = [
            {
                id: 'old',
                projectId: 'project',
                parentId: 'chat',
                childId: 'child',
                title: 'Old task',
                prompt: 'Work',
                status: 'open',
                result: null,
                createdAt: 1,
                settledAt: null,
                wake: 'pending'
            }
        ];
        const first = boot({ taskRows: () => tasks });
        await first.manager.create({ chatId: 'chat', cwd: home });
        expect(first.manager.attach('chat', 'watcher').items).toHaveLength(1);

        await first.manager.clear('chat');
        tasks[0] = { ...tasks[0]!, status: 'done', settledAt: 2 };
        first.manager.syncTaskRow(tasks[0]!);
        expect(first.manager.attach('chat', 'watcher').items).toEqual([]);
        expect((await new ChatStore(home).read('chat'))?.clearedTaskIds).toEqual(['old']);
        first.manager.persistAllSync();
        await first.manager.shutdown();

        const second = boot({ taskRows: () => tasks });
        await second.manager.create({ chatId: 'chat' });
        expect(second.manager.attach('chat', 'watcher').items).toEqual([]);
        tasks.push({ ...tasks[0]!, id: 'new', childId: 'new-child', status: 'open', settledAt: null });
        second.manager.syncTaskRow(tasks[1]!);
        expect(second.manager.attach('chat', 'watcher').items.map((item) => item.id)).toEqual(['task-new']);

        await second.manager.clear('chat');
        await second.manager.shutdown();
        const third = boot({ taskRows: () => tasks });
        await third.manager.create({ chatId: 'chat' });
        for (const task of tasks) {
            third.manager.syncTaskRow(task);
        }
        expect(third.manager.attach('chat', 'watcher').items).toEqual([]);
    });

    test('after a restart the stream goes on, and a seq the folded log no longer covers gets the whole thread', async () => {
        const first = boot();
        await first.manager.create({ chatId: 'chat', cwd: home });
        first.manager.attach('chat', 'watcher');
        await first.manager.send('chat', 'hello');
        await first.recorder.until(idle(first.recorder));
        const last = first.manager.attach('chat', 'client').seq!;
        await first.manager.shutdown();

        const second = boot();
        await second.manager.create({ chatId: 'chat' });
        // The info the load settles is an event of its own, so a client that saw everything before hears it too.
        const caughtUp = second.manager.attach('chat', 'client', undefined, last);
        expect(caughtUp.items).toEqual([]);
        expect(caughtUp.events?.map((event) => event.type)).toEqual(['info']);
        expect(second.numbered[0]?.seq).toBe(last + 1);

        const behind = second.manager.attach('chat', 'client', undefined, last - 1);
        expect(behind.events).toBeUndefined();
        expect(behind.items.map((item) => item.kind)).toEqual(['turn', 'user', 'thinking', 'assistant']);
    });

    test('a turn a CLI was in the middle of stays running through a stop the CLI dies in, when a resume is owed', async () => {
        const first = boot();
        await first.manager.create({ chatId: 'chat', cwd: home });
        first.manager.attach('chat', 'watcher');
        await first.manager.send('chat', 'slow');
        await first.recorder.until(() => first.recorder.info?.agentSessionId !== null && first.recorder.info?.agentSessionId !== undefined);
        const turnId = first.recorder.info!.activeTurnId!;
        first.manager.persistAllSync();
        await first.manager.shutdown();
        // The CLI is gone, and its exit said nothing to the thread.
        await claude.started[0]!.exited;
        expect(first.manager.get('chat')?.info.activeTurnId).toBe(turnId);

        const owed: unknown[] = [];
        const second = boot({ onInterruptedRun: async (run) => owed.push(run) > 0 });
        const info = await second.manager.create({ chatId: 'chat' });
        expect(owed).toEqual([{ chatId: 'chat', turnId, attempt: 2 }]);
        expect(info).toMatchObject({ status: 'running', activeTurnId: turnId, running: false });
        expect(second.manager.get('chat')?.thread.get(turnId)).toMatchObject({ state: 'running' });

        // With nothing to owe it to, the turn ends aborted and the note says why.
        await second.manager.shutdown();
        const third = boot();
        await third.manager.create({ chatId: 'chat' });
        expect(third.manager.get('chat')?.thread.get(turnId)).toMatchObject({ state: 'aborted' });
        expect(third.manager.get('chat')?.info).toMatchObject({ status: 'idle', activeTurnId: null });
        expect(
            third.manager
                .get('chat')
                ?.thread.list()
                .find((item) => item.kind === 'note')
        ).toMatchObject({
            turnId,
            level: 'warning',
            text: 'This turn could not be resumed after the machine restarted: this machine does not resume turns'
        });
    });
});

describe('the record of a chat', () => {
    test('turns after its first write only go to the log, and a machine that went down without a word still reads every one', async () => {
        const store = new RecordingStore(home, attachments);
        const first = boot({ store });
        await first.manager.create({ chatId: 'chat', cwd: home });
        first.manager.attach('chat', 'watcher');
        for (const prompt of ['one', 'two', 'three', 'four', 'five']) {
            await first.manager.send('chat', prompt);
            await first.recorder.until(idle(first.recorder));
        }
        await first.manager.persisted('chat');
        expect(store.calls).toEqual(['write chat']);
        const items = first.manager.get('chat')!.thread.list();
        expect(items.filter((item) => item.kind === 'turn')).toHaveLength(5);

        // Down without a shutdown: nothing is folded or written on the way out.
        first.manager.get('chat')!.dispose();
        managers.splice(managers.indexOf(first.manager), 1);
        const second = boot();
        await second.manager.create({ chatId: 'chat' });
        expect(second.manager.get('chat')!.thread.list()).toEqual(items);
    });

    test('a log that passed its bound is folded into the record at the next write, which leaves the log short', async () => {
        const store = new RecordingStore(home, attachments);
        const { manager, recorder } = boot({ store });
        await manager.create({ chatId: 'chat', cwd: home });
        manager.attach('chat', 'watcher');
        await manager.send('chat', `output:${COMPACT_ABOVE_BYTES + 1024}`);
        await recorder.until(idle(recorder));
        await manager.persisted('chat');

        expect(store.calls).toEqual(['write chat', 'write chat']);
        expect((await stat(join(home, 'chats', 'chat.json'))).size).toBeGreaterThan(COMPACT_ABOVE_BYTES);
        // Gone when nothing came after the fold.
        expect((await readFile(store.logPath('chat'), 'utf8').catch(() => '')).length).toBeLessThan(16 * 1024);
    });
});
