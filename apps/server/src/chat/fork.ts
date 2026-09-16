import { randomUUID } from 'node:crypto';
import { join } from 'node:path';
import {
    isCanvasView,
    NODE_SIZE,
    withView,
    type AgentKind,
    type ChatForkInfoPayload,
    type ChatForkInfoResult,
    type ChatForkPayload,
    type ChatForkResult,
    type ChatInfo,
    type ChatItem,
    type ChatTurnItem,
    type ModelSelection,
    type RuntimeMode,
    type ProjectCanvasView,
    type ProjectChatView,
    type ProjectContent,
    type ProjectEdge,
    type Worktree
} from '@ruimte/contracts';
import { agentNode, nameOf } from '../canvas/agent-verb.ts';
import { MAX_CANVAS_NODES, newId } from '../canvas/node-verb.ts';
import { placeFree } from '../canvas/placement.ts';
import { narrowerMode } from '../canvas/mode.ts';
import { branchSlug, freeBranch } from '../canvas/worktree.ts';
import type { Checkpoints } from '../git/checkpoints.ts';
import { git } from '../git/run.ts';
import type { Worktrees } from '../git/worktrees.ts';
import type { CanvasHost } from '../canvas/verb.ts';
import type { IndexedPlace } from '../projects/project-index.ts';
import type { AgentLineageStore } from '../agents/lineage.ts';
import { codexServiceTier, codexThreadOptions } from '../providers/codex.ts';
import type { ChatManager } from './chat-manager.ts';
import { forkClaudeTranscript, type TranscriptCutPoint } from './claude-fork.ts';
import { forkThreadOnce } from './codex-thread.ts';
import { ChatError } from './errors.ts';
import { handoffText } from './handoff.ts';

/* Where a Codex fork goes on after: the turn Codex named, the n-th turn when it named none, or all of it. */
export type ThreadCutPoint = { turnId: string } | { turns: number } | null;

export interface ChatForkDeps {
    /* The chat as it stands, loaded or on disk; null when this machine has no such chat. */
    source(chatId: string): Promise<{ info: ChatInfo; items: ChatItem[] } | null>;
    installed(): Promise<AgentKind[]>;
    /* The model and mode a chat of this CLI starts with: the one named, else the newest composer pick. */
    startingPoint(provider: AgentKind, selection?: ModelSelection): { selection: ModelSelection; runtimeMode?: RuntimeMode; contextWindow: number | null };
    locate(id: string): IndexedPlace | null;
    titleFor(id: string): string | null;
    read: CanvasHost['read'];
    mutate: CanvasHost['mutate'];
    depthOf(nodeId: string): number;
    recordFork(record: { projectId: string; nodeId: string; openedBy: string; depth: number }): Promise<void>;
    /* Writes the cut transcript under the new session id and answers how to take it back. */
    forkClaude(input: { source: ChatInfo; at: TranscriptCutPoint; newSessionId: string; cwd: string }): Promise<{ undo(): Promise<void> }>;
    /* Forks the thread in Codex into the fork's folder and answers the new thread's id. */
    forkCodex(input: { source: ChatInfo; at: ThreadCutPoint; cwd: string }): Promise<string>;
    /* The local branches of the repository a folder is in, or null outside one. */
    branchesOf(folder: string): Promise<string[] | null>;
    /* A worktree on a new branch for the fork, with the folder in it that matches the original's, and how to take it back. */
    addWorktree(input: { cwd: string; branch: string; projectId: string; nodeId: string }): Promise<{ worktree: Worktree; cwd: string; undo(): Promise<void> }>;
    treeExists(cwd: string, tree: string): Promise<boolean>;
    /* The tree of a folder as it is now, or null when git cannot take one. */
    takeTree(cwd: string): Promise<string | null>;
    restoreTree(cwd: string, tree: string): Promise<void>;
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

/* Where the fork's files come from: the original's folder, or a worktree of its own that starts after the turn or from HEAD. */
export type ForkFiles = { kind: 'shared'; repository: boolean } | { kind: 'worktree'; path: string; branch: string; afterTurn: boolean };

/* What the person reads under the copied history, and what the agent is told in front of its first prompt. */
export const forkNotes = (cut: Cut, original: { id: string; title: string; view: boolean }, files: ForkFiles): { note: string; preamble: string } => {
    const where = cut.last ? `its last turn (turn ${cut.number})` : `turn ${cut.number} of ${cut.total}`;
    const counted = cut.exact || cut.last ? '' : ' The cut was made by counting turns, since this turn is older than the names the CLI gives them.';
    const outside = files.kind === 'shared' && !files.repository ? ' The folder is in no git repository, so the fork has no worktree of its own.' : '';
    let personFiles: string;
    let folder: string;
    if (files.kind === 'worktree') {
        personFiles = files.afterTurn
            ? `The files start from the state after that turn, in worktree ${files.branch}.`
            : `The files start from HEAD, in worktree ${files.branch}.`;
        folder = files.afterTurn
            ? `You work in a git worktree at ${files.path} on branch ${files.branch}, with the files as they were after that turn.`
            : `You work in a git worktree at ${files.path} on branch ${files.branch}, from the current HEAD, so work the original left uncommitted is not there; check before you assume.`;
    } else {
        personFiles = cut.last ? 'Both work in the same folder from here.' : 'The files stay as they are now, which may be newer than that turn.';
        folder = cut.last
            ? 'You work in the same folder as the original, which may go on working there, so check the files before you assume.'
            : 'You work in the same folder as the original; its files may be newer than that turn, so check before you assume.';
    }
    const note = `Forked from ${original.title} after ${where}. ${personFiles}${outside}${counted}`;
    const preamble = [
        `Ruimte: this conversation was forked from ${original.view ? 'view' : 'node'} ${original.id} ("${original.title}") after ${where}; what follows that turn there did not happen here.`,
        folder,
        ...(cut.exact || cut.last ? [] : ['The cut was made by counting turns; if the last message you remember does not match, say so.'])
    ].join(' ');
    return { note, preamble };
};

/* The CLIs with a chat that can be forked and go on a fork. */
const CHAT_CLIS: ReadonlySet<AgentKind> = new Set(['claude', 'codex']);

/* What the person reads under the copied history of a fork that goes on with another CLI. */
export const switchNote = (cut: Cut, original: { title: string }, files: ForkFiles, handoff: { to: string; turns: number; all: boolean }): string => {
    const where = cut.last ? `its last turn (turn ${cut.number})` : `turn ${cut.number} of ${cut.total}`;
    const place =
        files.kind === 'worktree'
            ? files.afterTurn
                ? ` The files start from the state after that turn, in worktree ${files.branch}.`
                : ` The files start from HEAD, in worktree ${files.branch}.`
            : cut.last
              ? ' Both work in the same folder from here.'
              : ' The files stay as they are now, which may be newer than that turn.';
    const read = handoff.all ? 'the whole conversation' : `the last ${handoff.turns === 1 ? 'turn' : `${handoff.turns} turns`}`;
    return `Forked from ${original.title} after ${where} and continued with ${handoff.to}.${place} The agent got ${read} as text and can read the rest of ${original.title} through ruimte-context.`;
};

const cliRefusal = (error: unknown): ChatError =>
    error instanceof ChatError ? error : new ChatError('fork-failed', error instanceof Error ? error.message : String(error));

/*
 * The tree of the files after a turn: the one taken when it settled, else the one the next turn
 * started from (the same folder, unless a person changed it in between). Null when neither was taken.
 */
export const treeAfterTurn = (turns: readonly ChatTurnItem[], index: number): string | null =>
    turns[index]?.checkpointAfter ?? turns[index + 1]?.checkpoint ?? null;

/* What the fork dialog needs to know before it offers a worktree and the files of a turn. */
export const readForkInfo = async (deps: ChatForkDeps, payload: ChatForkInfoPayload): Promise<ChatForkInfoResult> => {
    const source = await deps.source(payload.chatId);
    if (source === null) {
        throw new ChatError('chat-not-found', `No chat ${payload.chatId}`);
    }
    const turns = source.items.filter((item): item is ChatTurnItem => item.kind === 'turn');
    const index = turns.findIndex((turn) => turn.id === payload.turnId);
    if (index === -1) {
        throw new ChatError('turn-not-found', `${payload.chatId} has no turn ${payload.turnId}`);
    }
    const branches = await deps.branchesOf(source.info.cwd);
    if (branches === null) {
        return { repository: false, branches: [], branch: null, filesAfterTurn: false };
    }
    const tree = treeAfterTurn(turns, index);
    const filesAfterTurn = tree === null ? index === turns.length - 1 : await deps.treeExists(source.info.cwd, tree);
    const title = `${deps.titleFor(payload.chatId) ?? nameOf(source.info.provider)} (fork)`;
    return { repository: true, branches, branch: freeBranch(branchSlug(title), new Set(branches)), filesAfterTurn };
};

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
    const provider = payload.provider ?? info.provider;
    // Another CLI has no copy of the conversation to make; it reads it as text instead.
    const switching = provider !== info.provider;
    if (!CHAT_CLIS.has(info.provider) || !CHAT_CLIS.has(provider)) {
        throw new ChatError('chat-unsupported', `${nameOf(CHAT_CLIS.has(provider) ? info.provider : provider)} has no chat that can be forked`);
    }
    if (!(await deps.installed()).includes(provider)) {
        throw new ChatError('provider-not-installed', `${nameOf(provider)} is not installed on this machine`);
    }
    if (info.agentSessionId === null && !switching) {
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

    // Steps taken back in reverse when a later one is refused.
    const undoers: Array<() => Promise<void>> = [];
    const undo = async (): Promise<void> => {
        for (const step of undoers.toReversed()) {
            await step().catch(() => undefined);
        }
    };

    let files: ForkFiles;
    let worktree: Worktree | undefined;
    let cwd = info.cwd;
    const branches = await deps.branchesOf(info.cwd);
    if (payload.worktree === undefined) {
        files = { kind: 'shared', repository: branches !== null };
    } else {
        if (branches === null) {
            throw new ChatError('not-a-repository', `${info.cwd} is not in a git repository, so the fork cannot have a worktree`);
        }
        const tree = payload.filesAfterTurn === true ? await filesTree(deps, info.cwd, turns, index) : null;
        const branch = payload.worktree.branch ?? freeBranch(branchSlug(title), new Set(branches));
        if (branches.includes(branch)) {
            throw new ChatError('branch-exists', `The branch ${branch} exists already; name another one`);
        }
        const made = await deps.addWorktree({ cwd: info.cwd, branch, projectId: place.projectId, nodeId: forkId }).catch((error: unknown) => {
            throw new ChatError('worktree-failed', `The worktree for ${branch} could not be made: ${error instanceof Error ? error.message : String(error)}`);
        });
        undoers.push(() => made.undo());
        if (tree !== null) {
            try {
                await deps.restoreTree(made.worktree.path, tree);
            } catch (error) {
                await undo();
                throw cliRefusal(error);
            }
        }
        worktree = made.worktree;
        cwd = made.cwd;
        files = { kind: 'worktree', path: made.cwd, branch, afterTurn: tree !== null };
    }

    let agentSessionId: string | null = null;
    try {
        if (switching) {
            agentSessionId = null;
        } else if (info.provider === 'codex') {
            agentSessionId = await deps.forkCodex({
                source: info,
                at: native !== undefined ? { turnId: native } : last ? null : { turns: cut.number },
                cwd
            });
        } else {
            agentSessionId = deps.newSessionId();
            const written = await deps.forkClaude({
                source: info,
                at: native !== undefined ? { lastUuid: native } : last ? 'whole' : { turns: cut.number },
                newSessionId: agentSessionId,
                cwd
            });
            undoers.push(() => written.undo());
        }
    } catch (error) {
        await undo();
        throw cliRefusal(error);
    }

    const now = deps.now();
    const original = { id: payload.chatId, title: originalTitle, view: place.canvasId === null };
    const copied = itemsThrough(source.items, turn.id);
    let notes = forkNotes(cut, original, files);
    let start: { selection: ModelSelection; runtimeMode: RuntimeMode; contextWindow: number | null } = {
        selection: payload.selection === undefined ? info.selection : deps.startingPoint(provider, payload.selection).selection,
        runtimeMode: info.runtimeMode,
        contextWindow: info.usage.contextWindow
    };
    if (switching) {
        const point = deps.startingPoint(provider, payload.selection);
        // Going on with another CLI is no way to be allowed more than the original was.
        start = { ...point, runtimeMode: narrowerMode(point.runtimeMode ?? info.runtimeMode, info.runtimeMode) };
        const handoff = handoffText(copied, {
            fromName: nameOf(info.provider),
            originalId: payload.chatId,
            originalTitle,
            view: original.view,
            turnNumber: cut.number,
            totalTurns: cut.total,
            at: now,
            cwd,
            worktree: files.kind === 'worktree' ? { branch: files.branch, afterTurn: files.afterTurn } : null
        });
        notes = { note: switchNote(cut, original, files, { to: nameOf(provider), turns: handoff.turns, all: handoff.all }), preamble: handoff.text };
    }
    const { queue: _queue, suggestedTitle: _suggestedTitle, skills: _skills, ...kept } = info;
    const forkInfo: ChatInfo = {
        ...kept,
        chatId: forkId,
        provider,
        cwd,
        agentSessionId,
        ...(switching ? { model: null, slashCommands: [] } : {}),
        selection: start.selection,
        runtimeMode: start.runtimeMode,
        status: 'idle',
        running: false,
        activeTurnId: null,
        // The turns before the cut are what fixes a chat to its CLI; what they cost stays the original's.
        usage: { ...info.usage, contextWindow: start.contextWindow, contextTokens: 0, costUsd: 0, turns: cut.number },
        forkOf: { chatId: payload.chatId, turnId: turn.id, at: now },
        createdAt: now
    };
    const items: ChatItem[] = [...copied, { id: `note-fork-${now}`, kind: 'note', createdAt: now, turnId: null, level: 'info', text: notes.note }];
    undoers.push(() => deps.deleteRecord(forkId));
    try {
        await deps.writeRecord(forkId, forkInfo, items, [notes.preamble]);
    } catch (error) {
        await undo();
        throw error;
    }
    const answer = worktree === undefined ? {} : { worktree };

    return deps
        .mutate(place.projectId, (content) => {
            if (content.views.some((view) => view.id === forkId || (isCanvasView(view) && view.nodes.some((node) => node.id === forkId)))) {
                throw new ChatError('fork-failed', `The id ${forkId} was taken while the fork was made; try again`);
            }
            const nodeCwd = cwd === place.folder ? undefined : cwd;
            const landed = () => deps.recordFork({ projectId: place.projectId, nodeId: forkId, openedBy: payload.chatId, depth: deps.depthOf(payload.chatId) });
            if (intoView) {
                const view: ProjectChatView = {
                    kind: 'chat',
                    id: forkId,
                    name: title,
                    titleSource: 'user',
                    node: { provider, providerFixed: true, ...(nodeCwd === undefined ? {} : { cwd: nodeCwd }) }
                };
                return {
                    content: { ...content, views: withView(content.views, view, originViewOf(content, place, payload.chatId)) },
                    result: { info: forkInfo, nodeId: forkId, viewId: forkId, edgeId: null, ...answer },
                    landed
                };
            }
            const canvas = forkCanvas(content, place, payload);
            if (canvas.nodes.length + 1 > MAX_CANVAS_NODES) {
                throw new ChatError('canvas-full', `${canvas.name} already holds the ${MAX_CANVAS_NODES} nodes a canvas may hold`);
            }
            const anchor = place.canvasId === null ? null : (canvas.nodes.find((node) => node.id === payload.chatId) ?? null);
            const rect = placeFree(canvas.nodes, NODE_SIZE.chat, anchor);
            const node = agentNode({ id: forkId, chat: true, kind: provider, title, rect, cwd: nodeCwd });
            const edge: ProjectEdge | null = anchor ? { id: newId('edge', content, [forkId]), from: anchor.id, to: forkId, label: 'context' } : null;
            return {
                content: {
                    ...content,
                    views: content.views.map((view) =>
                        view.id === canvas.id ? { ...canvas, nodes: [...canvas.nodes, node], edges: edge ? [...canvas.edges, edge] : canvas.edges } : view
                    )
                },
                result: { info: forkInfo, nodeId: forkId, viewId: canvas.id, edgeId: edge?.id ?? null, ...answer },
                landed
            };
        })
        .catch(async (error: unknown) => {
            await undo();
            throw error;
        });
};

/*
 * The tree a worktree fork puts its files to, checked before anything is made: the files after the
 * turn, or the folder as it is now for a last turn whose tree was never taken. A tree git collected
 * is refused, so the dialog can offer the fork from HEAD instead.
 */
const filesTree = async (deps: ChatForkDeps, cwd: string, turns: readonly ChatTurnItem[], index: number): Promise<string | null> => {
    const tree = treeAfterTurn(turns, index);
    if (tree === null) {
        if (index === turns.length - 1) {
            return await deps.takeTree(cwd);
        }
        throw new ChatError('checkpoint-missing', 'No tree of the files after this turn was taken, so the fork can only start from HEAD');
    }
    if (!(await deps.treeExists(cwd, tree))) {
        throw new ChatError('checkpoint-missing', 'The files of this turn are no longer in the repository, so the fork can only start from HEAD');
    }
    return tree;
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
    worktrees?: Pick<Worktrees, 'add' | 'remove' | 'branches'>;
    checkpoints?: Pick<Checkpoints, 'take' | 'exists' | 'restore'>;
}): ChatForkDeps => ({
    source: (chatId) => wiring.chats.forkSource(chatId),
    installed: () => wiring.host.installedAgents(),
    startingPoint: (provider, selection) => wiring.chats.startingPoint(provider, selection),
    locate: (id) => wiring.host.locate(id),
    titleFor: (id) => wiring.titleFor(id),
    read: (projectId) => wiring.host.read(projectId),
    mutate: (projectId, apply) => wiring.host.mutate(projectId, apply),
    depthOf: (nodeId) => wiring.lineage.depthOf(nodeId),
    recordFork: (record) => wiring.lineage.put({ ...record, agent: true, relation: 'fork' }),
    forkClaude: ({ source, at, newSessionId, cwd }) =>
        forkClaudeTranscript({
            projectsDir: wiring.chats.claudeProjectsDir,
            cwd: source.cwd,
            sessionId: source.agentSessionId ?? '',
            at,
            forkCwd: cwd,
            newSessionId
        }),
    forkCodex: ({ source, at, cwd }) => {
        const tier = codexServiceTier(source.selection);
        return forkThreadOnce(wiring.chats.codexProcess(source.cwd), {
            threadId: source.agentSessionId ?? '',
            at,
            options: {
                cwd,
                model: source.selection.model,
                ...(tier === null ? {} : { serviceTier: tier }),
                ...codexThreadOptions(source.runtimeMode)
            }
        });
    },
    branchesOf: async (folder) => (wiring.worktrees ? wiring.worktrees.branches(folder).catch(() => null) : null),
    addWorktree: async ({ cwd, branch, projectId, nodeId }) => {
        if (!wiring.worktrees) {
            throw new ChatError('not-a-repository', 'This machine makes no worktrees');
        }
        const worktrees = wiring.worktrees;
        // A chat in a subfolder of the repository goes on in the same subfolder of the worktree.
        const prefix = ((await git(['rev-parse', '--show-prefix'], cwd)) ?? '').trim();
        const { worktree } = await worktrees.add(cwd, branch, { madeBy: 'fork', projectId, nodeId });
        return {
            worktree,
            cwd: prefix === '' ? worktree.path : join(worktree.path, prefix).replace(/\/$/, ''),
            // Made a moment ago by this fork, and only taken back because the fork itself was refused.
            undo: async () => {
                await worktrees.remove(cwd, worktree.path, { force: true });
            }
        };
    },
    treeExists: async (cwd, tree) => (wiring.checkpoints ? wiring.checkpoints.exists(cwd, tree) : false),
    takeTree: async (cwd) => (wiring.checkpoints ? wiring.checkpoints.take(cwd) : null),
    restoreTree: async (cwd, tree) => {
        if (!wiring.checkpoints) {
            throw new ChatError('checkpoint-missing', 'This machine keeps no trees of turns');
        }
        await wiring.checkpoints.restore(cwd, tree);
    },
    writeRecord: (chatId, info, items, preambles) => wiring.chats.writeRecord(chatId, info, items, preambles),
    deleteRecord: (chatId) => wiring.chats.deleteRecord(chatId),
    newSessionId: () => randomUUID(),
    now: () => Date.now()
});
