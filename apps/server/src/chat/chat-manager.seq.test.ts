import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatAttachResult, ChatEvent } from '@ruimte/contracts';
import { ProviderRegistry } from '../providers/registry.ts';
import { AttachmentStore } from './attachment-store.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatStore } from './chat-store.ts';
import { ChatRecorder } from './chat-test-helpers.ts';
import { fakeClaude } from './fake-claude.ts';
import { inProcess, type InProcessCli } from './fake-cli.ts';
import { ChatThread } from './thread.ts';

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
            // The client as it stood at `since`: the thread it attached to with every event up to there applied.
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
});
