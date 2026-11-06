import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { AttachmentStore } from '@adecore/agents/chat';
import { fakeClaude, inProcess } from '@adecore/agents/testing';
import type { ChatItem, ContextSource } from '@ruimte/contracts';
import { ProviderRegistry } from '../providers/registry.ts';
import { OPEN_BOUNDS } from '../sessions/open-bounds-test-helpers.ts';
import { ChatManager } from './chat-manager.ts';
import { ChatRecorder, RecordingStore } from './chat-test-helpers.ts';

const FIXTURE = join(dirname(fileURLToPath(import.meta.resolve('@adecore/agents/chat'))), 'fixtures', 'claude-projects');
const LINKED: ContextSource[] = [{ id: 'dev-1', kind: 'device', title: 'iPhone 18 Pro Max' }];
// A chat's title timer and its CLI outlive a shutdown; only a dispose ends them.
export async function retire(target: ChatManager): Promise<void> {
    await target.shutdown();
    for (const info of target.list()) {
        target.get(info.chatId)?.dispose();
    }
}
export async function makeChatFixture() {
    const home = await mkdtemp(join(tmpdir(), 'ruimte-chat-'));
    const attachments = new AttachmentStore(home);
    const store = new RecordingStore(home, { attachments });
    const claude = inProcess(fakeClaude);
    const providers = new ProviderRegistry({ detect: async () => ({ installed: true, version: '0.0.0' }) });
    function makeManager(extra: Partial<ConstructorParameters<typeof ChatManager>[0]> = {}) {
        return new ChatManager({
            ...OPEN_BOUNDS,
            providers,
            store,
            attachments,
            spawn: claude.spawn,
            env: { PATH: process.env.PATH, HOME: home, RUIMTE_HOOK_URL: 'x' },
            ...extra
        });
    }
    const manager = makeManager();
    const recorder = new ChatRecorder();
    manager.subscribe('c1', recorder.sink());
    // A restart: the old manager goes, a new one reads the same store and the first client listens again.
    async function remake(current: ChatManager, extra: Parameters<typeof makeManager>[0] = {}): Promise<ChatManager> {
        await retire(current);
        const next = makeManager(extra);
        next.subscribe('c1', recorder.sink());
        return next;
    }
    async function open(target: ChatManager, chatId: string, request: Partial<Parameters<ChatManager['create']>[0]> = {}) {
        const info = await target.create({ chatId, cwd: home, ...request });
        target.attach(chatId, 'c1');
        return info;
    }
    function subagentWork(): Array<Extract<ChatItem, { kind: 'tool' | 'assistant' }>> {
        return [...recorder.items.values()].filter(
            (item): item is Extract<ChatItem, { kind: 'tool' | 'assistant' }> =>
                (item.kind === 'tool' || item.kind === 'assistant') && Boolean(item.parentToolUseId)
        );
    }
    return { home, attachments, store, claude, manager, recorder, makeManager, remake, open, subagentWork };
}
export { FIXTURE, LINKED };
