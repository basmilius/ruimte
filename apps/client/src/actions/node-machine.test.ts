import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { ChatState } from '@adecore/agents-react/state';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { useDocument } from '@/state/document';
import type { SessionState } from '@/state/sessions';
import { pool } from '@/transport';
import { chatScopeOf } from '@/transport/chat-scope';
import { fakeProvider } from '../../testing/fake-provider';
import { confirmed } from './action-support';
import { createClientActionRegistry, VOICE_ACTION_CALL } from './client-actions';

const GONE = 'machine-gone';
const refused = { status: 'failed', error: { code: 'no-machine' } };

const view: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Canvas',
    nodes: [
        { id: 'chat-far', kind: 'chat', title: 'Far chat', x: 0, y: 0, w: 400, h: 400, machine: GONE },
        { id: 'term-far', kind: 'terminal', title: 'Far shell', x: 500, y: 0, w: 400, h: 400, machine: GONE }
    ],
    texts: [],
    edges: [],
    layouts: []
} as ProjectCanvasView;

beforeEach(() => {
    useDocument.getState().load({ version: 3, rev: 1, name: 'Far', color: '#000', views: [view] }, { activeViewId: 'main', views: {} });
});

afterEach(() => {
    useDocument.getState().load(null, null);
});

const fresh = {
    info: { provider: 'claude', agentSessionId: null, usage: { turns: 0 } }
} as unknown as ChatState;

// Anything that reached the active machine would have opened its link.
function expectNothingSent(): void {
    expect(pool.peek('local')).toBeNull();
}

test('chat actions for a node on a machine this client does not know refuse instead of reaching the active machine', async () => {
    const registry = createClientActionRegistry(useDocument);

    expect(await registry.execute('chat.send', { chatId: 'chat-far', prompt: 'hello' }, VOICE_ACTION_CALL)).toMatchObject(refused);
    expect(await registry.execute('chat.read', { chatId: 'chat-far', limit: null }, VOICE_ACTION_CALL)).toMatchObject(refused);
    expect(await confirmed(registry, await registry.execute('chat.clear', { chatId: 'chat-far' }, VOICE_ACTION_CALL))).toMatchObject(refused);
    expectNothingSent();
});

test('terminal actions for such a node refuse the same way', async () => {
    const registry = createClientActionRegistry(useDocument, {
        sessions: { terminal: () => ({ exited: 0 }) as unknown as SessionState, terminalHost: () => null }
    });

    expect(await confirmed(registry, await registry.execute('terminal.clear', { terminalId: 'term-far' }, VOICE_ACTION_CALL))).toMatchObject(refused);
    expect(await confirmed(registry, await registry.execute('terminal.restart', { terminalId: 'term-far' }, VOICE_ACTION_CALL))).toMatchObject(refused);
    expectNothingSent();
});

test('switching the CLI of such a chat refuses', async () => {
    const registry = createClientActionRegistry(useDocument, {
        sessions: { chat: () => fresh, providers: () => [fakeProvider('codex', 'Codex')], providerFixed: () => false }
    });

    expect(await registry.execute('chat.setProvider', { chatId: 'chat-far', provider: 'codex', model: null }, VOICE_ACTION_CALL)).toMatchObject(refused);
    expectNothingSent();
});

test("the chat scope of such a machine answers no-machine rather than the active machine's chats", async () => {
    expect(chatScopeOf(GONE).chats.inspect('chat-far')).rejects.toMatchObject({ code: 'no-machine' });
    expectNothingSent();
});
