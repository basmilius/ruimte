import i18next from 'i18next';
import {
    isCanvasView,
    type AgentKind,
    type ChatForkPayload,
    type ChatInfo,
    type ChatItem,
    type ChatTurnItem,
    type ModelSelection,
    type ProjectView
} from '@ruimte/contracts';
import type { TimelineRow } from '@/chat/logic/timeline';

/* The providers whose chat a machine can fork, and go on with in a fork, are the ones with a conversation the CLI keeps. */
export const FORKABLE_PROVIDERS: ReadonlySet<string> = new Set(['claude', 'codex']);

/* Where a fork goes on after, as the dialog words it. */
export interface ForkPoint {
    turnId: string;
    number: number;
    total: number;
    last: boolean;
    /* The first line of what the person asked in that turn, or the label of a turn nobody typed. */
    prompt: string | null;
}

const turnsOf = (items: Record<string, ChatItem>, order: readonly string[]): ChatTurnItem[] =>
    order.flatMap((id) => {
        const item = items[id];
        return item?.kind === 'turn' ? [item] : [];
    });

/*
 * Why a chat cannot be forked after this turn right now, or null when it can. A turn still running,
 * or any turn in the chat, is a transcript that grows while it would be copied.
 */
export const forkRefusal = (info: ChatInfo | null, turn: ChatItem | undefined): string | null => {
    if (info === null || turn?.kind !== 'turn') {
        return i18next.t('chat:fork.refusal.notInConversation');
    }
    if (!FORKABLE_PROVIDERS.has(info.provider)) {
        return i18next.t('chat:fork.refusal.cliCannotFork');
    }
    if (info.agentSessionId === null) {
        return i18next.t('chat:fork.refusal.noConversation');
    }
    if (turn.state === 'running' || info.activeTurnId !== null) {
        return i18next.t('chat:fork.refusal.turnRunning');
    }
    return null;
};

/* Why a fork cannot write a summary for its original right now, or null when it can. */
export const summaryRefusal = (state: { busy: boolean; originalPresent: boolean }): string | null => {
    if (!state.originalPresent) {
        return i18next.t('chat:fork.refusal.originalGone');
    }
    if (state.busy) {
        return i18next.t('chat:fork.refusal.turnRunning');
    }
    return null;
};

/* The forks this client knows of that went on after this turn of this chat, in the order it holds them. */
export const forkIdsAfter = (infos: Iterable<ChatInfo>, chatId: string, turnId: string): string[] => {
    const ids: string[] = [];
    for (const info of infos) {
        if (info.forkOf?.chatId === chatId && info.forkOf.turnId === turnId) {
            ids.push(info.chatId);
        }
    }
    return ids;
};

/* The turns of this chat that at least one fork this client knows of went on after. */
export const forkedTurnIds = (infos: Iterable<ChatInfo>, chatId: string): Set<string> => {
    const turns = new Set<string>();
    for (const info of infos) {
        if (info.forkOf?.chatId === chatId) {
            turns.add(info.forkOf.turnId);
        }
    }
    return turns;
};

/* The last turn that ended, which is where a fork from the node's menu goes on after. */
export const lastSettledTurn = (items: Record<string, ChatItem>, order: readonly string[]): string | null =>
    turnsOf(items, order).findLast((turn) => turn.state !== 'running')?.id ?? null;

export const forkPointOf = (items: Record<string, ChatItem>, order: readonly string[], turnId: string): ForkPoint | null => {
    const turns = turnsOf(items, order);
    const index = turns.findIndex((turn) => turn.id === turnId);
    const turn = turns[index];
    if (turn === undefined) {
        return null;
    }
    const asked = order.map((id) => items[id]).find((item) => item?.kind === 'user' && item.turnId === turnId);
    const text = asked?.kind === 'user' ? asked.text : (turn.label ?? '');
    const prompt =
        text
            .split('\n')
            .find((line) => line.trim() !== '')
            ?.trim() ?? null;
    return { turnId, number: index + 1, total: turns.length, last: index === turns.length - 1, prompt };
};

/* The line at the top of the dialog: which turn, and what it was about. */
export const forkPointLabel = (point: ForkPoint, maxPrompt = 60): string => {
    const where = point.last ? i18next.t('chat:fork.point.afterLast') : i18next.t('chat:fork.point.afterTurn', { number: point.number, total: point.total });
    if (point.prompt === null) {
        return where;
    }
    const prompt = point.prompt.length > maxPrompt ? `${point.prompt.slice(0, maxPrompt - 1)}…` : point.prompt;
    return i18next.t('chat:fork.point.about', { where, prompt });
};

/* The turn a row of the thread belongs to, which is the turn "Fork from here" on that row goes on after. */
export const turnIdOfRow = (row: TimelineRow): string | null => {
    switch (row.kind) {
        case 'turn-start':
        case 'turn-fold':
            return row.turn.id;
        case 'changed-files':
        case 'forks':
            return row.turnId;
        case 'work':
        case 'work-live':
        case 'workflow':
            return row.tool.turnId;
        case 'work-group':
            return row.tools[0]?.turnId ?? null;
        case 'user':
        case 'assistant':
        case 'thinking':
        case 'subagent':
        case 'approval':
        case 'question':
            return row.item.turnId;
        default:
            return null;
    }
};

/* What a fork becomes: a chat node on a canvas, or a chat view of its own in the sidebar. */
export type ForkShape = 'node' | 'view';

/* What the dialog offers, first the default: a view forks into a view, and a node into a node or, when asked, a view. */
export const forkShapes = (origin: ForkShape): ForkShape[] => (origin === 'view' ? ['view'] : ['node', 'view']);

/* A worktree the fork works in, on this branch, with or without the files as they were after the turn. */
export interface ForkWorktreeChoice {
    branch: string;
    filesAfterTurn: boolean;
}

/* The CLI, model and account a fork goes on with; only what differs from the original is sent. */
export interface ForkCliChoice {
    provider: AgentKind;
    selection: ModelSelection;
    /* By id, the CLI's kind for its default account; absent leaves it to the machine. */
    account?: string;
}

export const forkPayload = (input: {
    chatId: string;
    turnId: string;
    title: string;
    shape: ForkShape;
    worktree?: ForkWorktreeChoice | null;
    cli?: { original: ForkCliChoice; chosen: ForkCliChoice };
}): ChatForkPayload => ({
    chatId: input.chatId,
    turnId: input.turnId,
    title: input.title,
    ...(input.shape === 'view' ? { asView: true } : {}),
    ...(input.cli && input.cli.chosen.provider !== input.cli.original.provider ? { provider: input.cli.chosen.provider } : {}),
    ...(input.cli && (input.cli.chosen.provider !== input.cli.original.provider || input.cli.chosen.selection.model !== input.cli.original.selection.model)
        ? { selection: input.cli.chosen.selection }
        : {}),
    ...(input.cli?.chosen.account !== undefined &&
    (input.cli.chosen.provider !== input.cli.original.provider || input.cli.chosen.account !== input.cli.original.account)
        ? { account: input.cli.chosen.account }
        : {}),
    ...(input.worktree ? { worktree: { branch: input.worktree.branch }, ...(input.worktree.filesAfterTurn ? { filesAfterTurn: true } : {}) } : {})
});

/* Why a branch cannot be the fork's, or null when it can. */
export const branchRefusal = (branch: string, taken: readonly string[]): string | null => {
    const name = branch.trim();
    if (name === '') {
        return i18next.t('chat:fork.branch.unnamed');
    }
    if (taken.includes(name)) {
        return i18next.t('chat:fork.branch.taken');
    }
    return null;
};

/* Where a chat stands in the project: a node on a canvas or a view of its own, under the name it goes by. */
export interface ForkOrigin {
    shape: ForkShape;
    title: string;
}

export const forkOriginIn = (views: readonly ProjectView[], chatId: string): ForkOrigin | null => {
    for (const view of views) {
        if (view.kind === 'chat' && view.id === chatId) {
            return { shape: 'view', title: view.name };
        }
        if (isCanvasView(view)) {
            const node = view.nodes.find((candidate) => candidate.id === chatId && candidate.kind === 'chat');
            if (node) {
                return { shape: 'node', title: node.title };
            }
        }
    }
    return null;
};
