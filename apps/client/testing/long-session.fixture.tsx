import { ChatHostProvider } from '@adecore/agents-react';
import type { ChatItem, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { createRoot } from 'react-dom/client';
import { App } from '../src/App';
import { CHAT_HOST, configureChat } from '../src/chat/host';
import { initI18n } from '../src/i18n';
import { startFileReadPreparation } from '../src/project/file-read-preparation';
import { showView } from '../src/project/views';
import { defaultCanvases } from '../src/state/canvas';
import { defaultDocumentStore } from '../src/state/document';
import { useFiles } from '../src/state/files';
import { folderWatches } from '../src/state/fs-watch';
import { currentEndpointId } from '../src/state/keys';
import { defaultProjectStore } from '../src/state/project';
import { startSessionLifecycle } from '../src/terminal/lifecycle';
import { exposeTerminalTestHooks, screenOf } from '../src/terminal/registry';
import { chatInfoOf } from './chat-info';
import { FakeMachine } from './fake-machine';
import { claudeProvider } from './fake-provider';
import { openFakeWorkspace } from './fake-workspace';

/*
 * The whole window on a fake machine, with what an hour of work sends it in reach of the test through
 * `window.longSession`: turns streamed into chats, output into terminals, nodes opened and closed.
 */
const CHAT_NODE: ProjectNode = { id: 'chat-node', kind: 'chat', title: 'Chat', x: 0, y: 0, w: 560, h: 520, provider: 'claude' };
const SHELL: ProjectNode = { id: 'shell', kind: 'terminal', title: 'Shell', x: 600, y: 0, w: 560, h: 360 };
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [CHAT_NODE, SHELL], texts: [], edges: [], layouts: [] };
const ELSEWHERE: ProjectCanvasView = { kind: 'canvas', id: 'elsewhere', name: 'Elsewhere', nodes: [], texts: [], edges: [], layouts: [] };
const SENTENCE = 'The parser keeps its position in the stream, so a token that spans two chunks still reads as one. ';

const machine = new FakeMachine();
const closed: string[] = [];
let seq = 0;
let clock = 1;
let opened = 0;

machine.answer('provider.list', () => ({ providers: [claudeProvider({ chat: true, terminal: true, hooks: true })] }));
machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId), items: [], seq }) as never);
machine.answer('session.attach', () => ({ screen: '', cols: 80, rows: 24, exited: false }));
machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);

function send(chatId: string, event: unknown): void {
    seq += 1;
    machine.emit('chat.event', { chatId, event, seq } as never);
}

function item(chatId: string, value: Record<string, unknown>): void {
    send(chatId, { type: 'item', item: { createdAt: clock++, ...value } as ChatItem });
}

/* One turn of an agent at work: a question, some thinking, tool calls with their output, and a long answer streamed in pieces. */
function streamTurn(chatId: string, turn: number, tools: number, deltas: number): void {
    const turnId = `${chatId}-turn-${turn}`;
    const answer = `${turnId}-answer`;
    send(chatId, { type: 'info', info: chatInfoOf(chatId, { status: 'running', running: true, activeTurnId: turnId }) });
    item(chatId, { kind: 'turn', id: turnId, turnId, state: 'running', endedAt: null, costUsd: 0 });
    item(chatId, { kind: 'user', id: `${turnId}-user`, turnId, text: `Step ${turn}: look at the failing test and fix it.` });
    item(chatId, { kind: 'thinking', id: `${turnId}-thinking`, turnId, text: SENTENCE.repeat(8), streaming: false, endedAt: clock });

    for (let index = 0; index < tools; index++) {
        const tool = { kind: 'tool', id: `${turnId}-tool-${index}`, turnId, toolUseId: `${turnId}-use-${index}`, parentToolUseId: null, name: 'Bash' };
        const input = { command: `bun test src/case-${index}.test.ts` };
        item(chatId, { ...tool, input, output: null, state: 'running' });
        item(chatId, { ...tool, input, output: SENTENCE.repeat(60), state: 'done' });
    }

    item(chatId, { kind: 'assistant', id: answer, turnId, text: '', streaming: true });

    for (let index = 0; index < deltas; index++) {
        send(chatId, { type: 'delta', itemId: answer, text: SENTENCE });
    }

    item(chatId, { kind: 'assistant', id: answer, turnId, text: SENTENCE.repeat(deltas), streaming: false });
    item(chatId, { kind: 'turn', id: turnId, turnId, state: 'done', endedAt: clock, costUsd: 0.01 });
    send(chatId, { type: 'info', info: chatInfoOf(chatId, { status: 'idle', running: false, activeTurnId: null }) });
}

/* What a build or a test run prints, a line at a time, in color. */
function terminalOutput(sessionId: string, lines: number): void {
    for (let index = 0; index < lines; index++) {
        machine.emit('session.output', { sessionId, data: `\x1b[32m✓\x1b[0m ${index} ${SENTENCE}\r\n` });
    }
}

/* A terminal and a chat beside the ones that stay, the way a person opens them to try something. */
function openNodes(): void {
    const canvas = defaultCanvases.of(MAIN.id).getState();
    opened += 1;
    canvas.addNode('terminal', { x: 0, y: 600 + opened });
    canvas.addNode('chat', { x: 600, y: 600 + opened }, { provider: 'claude' } as never);
}

function nodeIds(kind: string): string[] {
    return Object.values(defaultCanvases.of(MAIN.id).getState().nodes)
        .filter((node) => node.kind === kind && node.id !== CHAT_NODE.id && node.id !== SHELL.id)
        .map((node) => node.id);
}

function closeOpened(): void {
    const ids = [...nodeIds('terminal'), ...nodeIds('chat')];
    closed.push(...ids);
    defaultCanvases.of(MAIN.id).getState().select(ids);
    defaultCanvases.of(MAIN.id).getState().deleteSelected();
}

/* How many closed terminals this window still keeps a screen of. */
function screensOfClosed(): number {
    const endpointId = currentEndpointId();

    return closed.filter((id) => screenOf(endpointId, id) !== null).length;
}

/* Shows a view of its own, or the one the shell is on, so the shell goes out of sight and comes back. */
function show(viewId: 'main' | 'elsewhere'): void {
    showView(viewId === 'main' ? MAIN.id : ELSEWHERE.id);
}

/* How many lines this window keeps of the shell; the whole scrollback while it is on screen. */
function linesOfShell(): number {
    return screenOf(currentEndpointId(), SHELL.id)?.length ?? 0;
}

function shellMounted(): boolean {
    return window.ruimte?.terminalText(SHELL.id) != null;
}

configureChat();
exposeTerminalTestHooks();
startSessionLifecycle();
startFileReadPreparation(defaultProjectStore, defaultDocumentStore, folderWatches, useFiles);
await initI18n();
await openFakeWorkspace(machine, { views: [MAIN, ELSEWHERE] }, { activeViewId: MAIN.id, views: {} });

createRoot(document.getElementById('root')!).render(
    <ChatHostProvider host={CHAT_HOST}>
        <App />
    </ChatHostProvider>
);

Object.assign(window, {
    longSession: { streamTurn, terminalOutput, openNodes, nodeIds, closeOpened, screensOfClosed, show, linesOfShell, shellMounted, shell: SHELL.id }
});
