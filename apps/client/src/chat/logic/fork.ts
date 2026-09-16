import { isCanvasView, type ChatForkPayload, type ChatInfo, type ChatItem, type ChatTurnItem, type ProjectView } from '@ruimte/contracts';
import type { TimelineRow } from '@/chat/logic/timeline';

/* The providers whose chat a machine can fork: the ones with a conversation the CLI keeps and can be cut. */
const FORKABLE_PROVIDERS: ReadonlySet<string> = new Set(['claude', 'codex']);

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
        return 'This turn is not in the conversation';
    }
    if (!FORKABLE_PROVIDERS.has(info.provider)) {
        return 'This CLI has no conversation that can be forked';
    }
    if (info.agentSessionId === null) {
        return 'The CLI never started a conversation here';
    }
    if (turn.state === 'running' || info.activeTurnId !== null) {
        return 'Wait for the turn to end';
    }
    return null;
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
    const where = point.last ? 'After the last turn' : `After turn ${point.number} of ${point.total}`;
    if (point.prompt === null) {
        return where;
    }
    const prompt = point.prompt.length > maxPrompt ? `${point.prompt.slice(0, maxPrompt - 3)}...` : point.prompt;
    return `${where}: "${prompt}"`;
};

/* The turn a row of the thread belongs to, which is the turn "Fork from here" on that row goes on after. */
export const turnIdOfRow = (row: TimelineRow): string | null => {
    switch (row.kind) {
        case 'turn-start':
        case 'turn-fold':
            return row.turn.id;
        case 'changed-files':
            return row.turnId;
        case 'work':
        case 'work-live':
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

export const forkPayload = (input: { chatId: string; turnId: string; title: string; shape: ForkShape }): ChatForkPayload => ({
    chatId: input.chatId,
    turnId: input.turnId,
    title: input.title,
    ...(input.shape === 'view' ? { asView: true } : {})
});

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
