import { randomUUID } from 'node:crypto';
import {
    isCanvasView,
    NODE_SIZE,
    withView,
    type AgentKind,
    type ChatForkPayload,
    type ChatForkResult,
    type ChatInfo,
    type ChatItem,
    type ChatTurnItem,
    type ProjectCanvasView,
    type ProjectChatView,
    type ProjectContent,
    type ProjectEdge
} from '@ruimte/contracts';
import { agentNode, nameOf } from '../canvas/agent-verb.ts';
import { MAX_CANVAS_NODES, newId } from '../canvas/node-verb.ts';
import { placeFree } from '../canvas/placement.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { AgentLineageStore } from '../agents/lineage.ts';
import { codexServiceTier, codexThreadOptions } from '../providers/codex.ts';
import type { ChatManager } from './chat-manager.ts';
import { forkClaudeTranscript, type TranscriptCutPoint } from './claude-fork.ts';
import { forkThreadOnce } from './codex-thread.ts';
import { ChatError } from './errors.ts';

/* Where a Codex fork goes on after: the turn Codex named, the n-th turn when it named none, or all of it. */
export type ThreadCutPoint = { turnId: string } | { turns: number } | null;

export interface ChatForkDeps {
    /* The chat as it stands, loaded or on disk; null when this machine has no such chat. */
    source(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] } | null>;
    installed(): Promise<AgentKind[]>;
    locate(id: string): IndexedPlace | null;
    titleFor(id: string): string | null;
    read: CanvasHost['read'];
    mutate: CanvasHost['mutate'];
    depthOf(nodeId: string): number;
    recordFork(record: { projectId: string; nodeId: string; openedBy: string; depth: number }): Promise<void>;
    /* Writes the cut transcript under the new session id and answers how to take it back. */
    forkClaude(input: { source: ChatInfo; at: TranscriptCutPoint; newSessionId: string }): Promise<{ undo(): Promise<void> }>;
    /* Forks the thread in Codex and answers the new thread's id. */
    forkCodex(input: { source: ChatInfo; at: ThreadCutPoint }): Promise<string>;
    writeRecord(chatId: string, info: ChatInfo, items: ChatItem[], preambles: string[]): Promise<void>;
    deleteRecord(chatId: string): Promise<void>;
    newSessionId(): string;
    now(): number;
}

const MAX_TITLE = 120;

/* The items up to and including a turn: its own and those of every turn before it, plus what belonged to no turn before its end. */
export const itemsThrough = (items: readonly ChatItem[], turnId: string): ChatItem[] => {
    const kept = new Set<string>();
    let end = -1;
    for (const [index, item] of items.entries()) {
        if (item.kind === 'turn' && !kept.has(turnId)) {
            kept.add(item.id);
        }
        if (item.turnId === turnId || item.id === turnId) {
            end = index;
        }
    }
    return items.filter((item, index) => (item.turnId === null ? index <= end : kept.has(item.turnId)));
};

interface Cut {
    turn: ChatTurnItem;
    number: number;
    total: number;
    last: boolean;
    /* Whether the CLI named where this turn ended; without that the cut counts turns. */
    exact: boolean;
}

/* What the person reads under the copied history, and what the agent is told in front of its first prompt. */
export const forkNotes = (cut: Cut, original: { id: string; title: string; view: boolean }): { note: string; preamble: string } => {
    const where = cut.last ? `its last turn (turn ${cut.number})` : `turn ${cut.number} of ${cut.total}`;
    const counted = cut.exact || cut.last ? '' : ' The cut was made by counting turns, since this turn is older than the names the CLI gives them.';
    const note = cut.last
        ? `Forked from ${original.title} after ${where}. Both work in the same folder from here.${counted}`
        : `Forked from ${original.title} after ${where}. The files stay as they are now, which may be newer than that turn.${counted}`;
    const folder = cut.last
        ? 'You work in the same folder as the original, which may go on working there, so check the files before you assume.'
        : 'You work in the same folder as the original; its files may be newer than that turn, so check before you assume.';
    const preamble = [
        `Ruimte: this conversation was forked from ${original.view ? 'view' : 'node'} ${original.id} ("${original.title}") after ${where}; what follows that turn there did not happen here.`,
        folder,
        ...(cut.exact || cut.last ? [] : ['The cut was made by counting turns; if the last message you remember does not match, say so.'])
    ].join(' ');
    return { note, preamble };
};

const cliRefusal = (error: unknown): ChatError =>
    error instanceof ChatError ? error : new ChatError('fork-failed', error instanceof Error ? error.message : String(error));

/*
 * A chat node beside the original, or a chat view listed after it, that goes on after one of its turns. The CLI's side is a copy made
 * now (a cut transcript, a Codex thread fork), so a fork is what the conversation was at the click and
 * not whatever the original says by the time a person types into the fork. The record is written
 * before the node, so a client that mounts the node finds the thread; no CLI starts until the first
 * message. A step that is refused takes back the steps before it, except a Codex thread, which Codex
 * gives no way to remove.
 */
export const forkChat = async (deps: ChatForkDeps, payload: ChatForkPayload): Promise<ChatForkResult> => {
    const source = await deps.source(payload.chatId);
    if (source === null) {
        throw new ChatError('chat-not-found', `No chat ${payload.chatId}`);
    }
    const { info } = source;
    const turns = source.items.filter((item): item is ChatTurnItem => item.kind === 'turn');
    const index = turns.findIndex((turn) => turn.id === payload.turnId);
    const turn = turns[index];
    if (turn === undefined) {
        throw new ChatError('turn-not-found', `${payload.chatId} has no turn ${payload.turnId}`);
    }
    if (turn.state === 'running') {
        throw new ChatError('turn-running', 'That turn is still running; fork it once it ends');
    }
    // A transcript that grows while it is copied is no copy of anything.
    if (info.activeTurnId !== null) {
        throw new ChatError('chat-busy', 'The chat is working on a turn; fork it once that turn ends');
    }
    if (info.provider !== 'claude' && info.provider !== 'codex') {
        throw new ChatError('chat-unsupported', `${nameOf(info.provider)} has no chat that can be forked`);
    }
    if (!(await deps.installed()).includes(info.provider)) {
        throw new ChatError('provider-not-installed', `${nameOf(info.provider)} is not installed on this machine`);
    }
    if (info.agentSessionId === null) {
        throw new ChatError('transcript-missing', `${nameOf(info.provider)} never started a conversation in this chat, so there is nothing to fork`);
    }
    const place = deps.locate(payload.chatId);
    if (place === null) {
        throw new ChatError('chat-not-found', `${payload.chatId} is in no project this machine knows`);
    }
    // A view forks into a view unless a canvas is named; a node forks into a node unless a view is asked for.
    const intoView = payload.asView === true || (place.canvasId === null && payload.viewId === undefined);

    const last = index === turns.length - 1;
    const native = info.provider === 'codex' ? turn.native?.turnId : turn.native?.lastUuid;
    const cut: Cut = { turn, number: index + 1, total: turns.length, last, exact: native !== undefined };
    const originalTitle = deps.titleFor(payload.chatId) ?? nameOf(info.provider);
    const title = (payload.title ?? `${originalTitle} (fork)`).slice(0, MAX_TITLE);
    const forkId = newId('chat', await deps.read(place.projectId));

    let agentSessionId: string;
    let undoCli = async (): Promise<void> => undefined;
    try {
        if (info.provider === 'codex') {
            agentSessionId = await deps.forkCodex({
                source: info,
                at: native !== undefined ? { turnId: native } : last ? null : { turns: cut.number }
            });
        } else {
            agentSessionId = deps.newSessionId();
            const written = await deps.forkClaude({
                source: info,
                at: native !== undefined ? { lastUuid: native } : last ? 'whole' : { turns: cut.number },
                newSessionId: agentSessionId
            });
            undoCli = () => written.undo();
        }
    } catch (error) {
        throw cliRefusal(error);
    }

    const now = deps.now();
    const notes = forkNotes(cut, { id: payload.chatId, title: originalTitle, view: place.canvasId === null });
    const { queue: _queue, suggestedTitle: _suggestedTitle, ...kept } = info;
    const forkInfo: ChatInfo = {
        ...kept,
        chatId: forkId,
        agentSessionId,
        status: 'idle',
        running: false,
        activeTurnId: null,
        // The CLI has the turns before the cut, which is what fixes a chat to its CLI; what they cost stays the original's.
        usage: { ...info.usage, contextTokens: 0, costUsd: 0, turns: cut.number },
        forkOf: { chatId: payload.chatId, turnId: turn.id, at: now },
        createdAt: now
    };
    const items: ChatItem[] = [
        ...itemsThrough(source.items, turn.id),
        { id: `note-fork-${now}`, kind: 'note', createdAt: now, turnId: null, level: 'info', text: notes.note }
    ];
    const undo = async (): Promise<void> => {
        await deps.deleteRecord(forkId).catch(() => undefined);
        await undoCli().catch(() => undefined);
    };
    try {
        await deps.writeRecord(forkId, forkInfo, items, [notes.preamble]);
    } catch (error) {
        await undo();
        throw error;
    }

    return deps
        .mutate(place.projectId, (content) => {
            if (content.views.some((view) => view.id === forkId || (isCanvasView(view) && view.nodes.some((node) => node.id === forkId)))) {
                throw new ChatError('fork-failed', `The id ${forkId} was taken while the fork was made; try again`);
            }
            const cwd = info.cwd === place.folder ? undefined : info.cwd;
            const landed = () => deps.recordFork({ projectId: place.projectId, nodeId: forkId, openedBy: payload.chatId, depth: deps.depthOf(payload.chatId) });
            if (intoView) {
                const view: ProjectChatView = {
                    kind: 'chat',
                    id: forkId,
                    name: title,
                    titleSource: 'user',
                    node: { provider: info.provider, providerFixed: true, ...(cwd === undefined ? {} : { cwd }) }
                };
                return {
                    content: { ...content, views: withView(content.views, view, originViewOf(content, place, payload.chatId)) },
                    result: { info: forkInfo, nodeId: forkId, viewId: forkId, edgeId: null },
                    landed
                };
            }
            const canvas = forkCanvas(content, place, payload);
            if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                throw new ChatError('canvas-full', `${canvas.name} already holds the ${MAX_CANVAS_NODES} nodes a canvas may hold`);
            }
            const anchor = place.canvasId === null ? null : (canvas.nodes.find((node) => node.id === payload.chatId) ?? null);
            const rect = placeFree(canvas.nodes, NODE_SIZE.chat, anchor);
            const node = agentNode({ id: forkId, chat: true, kind: info.provider, title, rect, cwd });
            const edge: ProjectEdge | null = anchor ? { id: newId('edge', content, [forkId]), from: anchor.id, to: forkId, label: 'context' } : null;
            return {
                content: {
                    ...content,
                    views: content.views.map((view) =>
                        view.id === canvas.id ? { ...canvas, nodes: [...canvas.nodes, node], edges: edge ? [...canvas.edges, edge] : canvas.edges } : view
                    )
                },
                result: { info: forkInfo, nodeId: forkId, viewId: canvas.id, edgeId: edge?.id ?? null },
                landed
            };
        })
        .catch(async (error: unknown) => {
            await undo();
            throw error;
        });
};

/* The view a fork that is a view is listed after: the original itself, or the canvas the original stands on. */
const originViewOf = (content: ProjectContent, place: IndexedPlace, chatId: string): string => {
    const id = place.canvasId ?? chatId;
    const view = content.views.find((candidate) => candidate.id === id);
    const stands = place.canvasId === null ? view?.kind === 'chat' : view !== undefined && isCanvasView(view) && view.nodes.some((node) => node.id === chatId);
    if (!stands) {
        throw new ChatError('chat-not-found', `${chatId} left the project while the fork was made`);
    }
    return id;
};

/* The canvas the fork lands on: the one the original stands on, else the one the payload names for a chat that is a view. */
const forkCanvas = (content: ProjectContent, place: IndexedPlace, payload: ChatForkPayload): ProjectCanvasView => {
    const id = place.canvasId ?? payload.viewId;
    const canvas = content.views.find((view) => view.id === id);
    if (!canvas || !isCanvasView(canvas)) {
        throw new ChatError('not-on-a-canvas', `${id ?? 'That view'} is not a canvas of this project`);
    }
    if (place.canvasId !== null && !canvas.nodes.some((node) => node.id === payload.chatId)) {
        throw new ChatError('chat-not-found', `${payload.chatId} left its canvas while the fork was made`);
    }
    return canvas;
};

/* The daemon's pieces a fork is made of, wired once for `daemon.ts` and the test daemon alike. */
export const chatForkDeps = (wiring: {
    chats: ChatManager;
    host: Pick<CanvasHost, 'installedAgents' | 'locate' | 'read' | 'mutate'>;
    titleFor(id: string): string | null;
    lineage: Pick<AgentLineageStore, 'depthOf' | 'put'>;
}): ChatForkDeps => ({
    source: (chatId) => wiring.chats.forkSource(chatId),
    installed: () => wiring.host.installedAgents(),
    locate: (id) => wiring.host.locate(id),
    titleFor: (id) => wiring.titleFor(id),
    read: (projectId) => wiring.host.read(projectId),
    mutate: (projectId, apply) => wiring.host.mutate(projectId, apply),
    depthOf: (nodeId) => wiring.lineage.depthOf(nodeId),
    recordFork: (record) => wiring.lineage.put({ ...record, agent: true, relation: 'fork' }),
    forkClaude: ({ source, at, newSessionId }) =>
        forkClaudeTranscript({
            projectsDir: wiring.chats.claudeProjectsDir,
            cwd: source.cwd,
            sessionId: source.agentSessionId ?? '',
            at,
            forkCwd: source.cwd,
            newSessionId
        }),
    forkCodex: ({ source, at }) => {
        const tier = codexServiceTier(source.selection);
        return forkThreadOnce(wiring.chats.codexProcess(source.cwd), {
            threadId: source.agentSessionId ?? '',
            at,
            options: {
                cwd: source.cwd,
                model: source.selection.model,
                ...(tier === null ? {} : { serviceTier: tier }),
                ...codexThreadOptions(source.runtimeMode)
            }
        });
    },
    writeRecord: (chatId, info, items, preambles) => wiring.chats.writeRecord(chatId, info, items, preambles),
    deleteRecord: (chatId) => wiring.chats.deleteRecord(chatId),
    newSessionId: () => randomUUID(),
    now: () => Date.now()
});
