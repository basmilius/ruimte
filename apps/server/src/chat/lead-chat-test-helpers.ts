import { mkdir, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { claudeProjectSlug } from '@adecore/agents/chat';
import type { ChatTurnItem, ProjectContent } from '@ruimte/contracts';
import type { ProjectStore } from '../projects/project-store.ts';
import type { TestDaemon } from '../testing/test-daemon.ts';
import { turnsOf } from './chat-test-helpers.ts';

/* A canvas with one Claude chat, `chat-lead`, which the fork tests copy and summarize. */
export function leadProject(): ProjectContent {
    return {
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
    };
}

/* `leadProject` with a terminal beside the chat, for the tools that only an AI chat may call. */
export function leadAndShellProject(): ProjectContent {
    const project = leadProject();
    const [canvas] = project.views;
    if (canvas?.kind !== 'canvas') {
        throw new Error('The lead project starts with a canvas');
    }
    return {
        ...project,
        views: [
            {
                ...canvas,
                nodes: [
                    { id: 'chat-lead', kind: 'chat', title: 'Lead', x: 0, y: 0, w: 560, h: 640, provider: 'claude' },
                    { id: 'term-lead', kind: 'terminal', title: 'Shell', x: 0, y: 700, w: 560, h: 360 }
                ]
            }
        ]
    };
}

/* Sends and waits until the chat ran exactly one more turn to its end, and `ready` accepts that turn. */
export async function sayAndSettle(daemon: TestDaemon, chatId: string, text: string, ready: (turn: ChatTurnItem) => boolean = () => true): Promise<void> {
    const before = turnsOf(daemon.chats.get(chatId)?.thread.list() ?? []).length;
    await daemon.chats.send(chatId, text);
    await daemon.until(() => {
        const chat = daemon.chats.get(chatId);
        const turns = turnsOf(chat?.thread.list() ?? []);
        return chat !== undefined && chat.info.activeTurnId === null && turns.length === before + 1 && ready(turns.at(-1)!);
    });
}

/* The transcript Claude Code would have written for the turns of `chat-lead`, keyed on the uuids they ended on. */
export async function writeLeadTranscript(
    daemon: TestDaemon,
    folder: string,
    turns: readonly ChatTurnItem[],
    options: { lastPrompt?: boolean; projectsDir?: string } = {}
): Promise<string> {
    const sessionId = daemon.chats.get('chat-lead')!.info.agentSessionId!;
    const lines = turns.flatMap((turn, index) => [
        { type: 'user', uuid: `prompt-${index}`, isSidechain: false, sessionId, message: { role: 'user', content: `turn ${index}` } },
        { type: 'assistant', uuid: turn.native!.lastUuid, isSidechain: false, sessionId, message: { content: [{ type: 'text', text: 'echo' }] } },
        ...(options.lastPrompt ? [{ type: 'last-prompt', sessionId, lastPrompt: `turn ${index}` }] : [])
    ]);
    const dir = join(options.projectsDir ?? daemon.chats.claudeProjectsDir, claudeProjectSlug(folder));
    await mkdir(dir, { recursive: true });
    await writeFile(join(dir, `${sessionId}.jsonl`), lines.map((entry) => JSON.stringify(entry)).join('\n'));
    return sessionId;
}

/* What a person does when they delete nodes from the canvas: they and the lines to them go. */
export async function removeNodes(store: ProjectStore, projectId: string, ids: Iterable<string>): Promise<void> {
    const gone = new Set(ids);
    await store.mutate(projectId, (current) => ({
        content: {
            ...current,
            views: current.views.map((view) => (view.kind === 'canvas' ? { ...view, nodes: view.nodes.filter((node) => !gone.has(node.id)), edges: [] } : view))
        },
        result: null
    }));
}
