import type { AgentKind, ComputerApproval } from '@ruimte/contracts';
import { orderPrompts, type PendingPrompt } from '@/prompts/logic/prompts';
import { isBlockingSubject, promptCreatedAt, promptIdOf, type PromptSubject } from '@/prompts/logic/subjects';
import type { CanvasNode } from '@/state/canvas';
import type { ChatsById, ChatState } from '@ruimte/agents-react/state/chats';
import { endpointKey } from '@/state/keys';
import { nodeStatus, type SessionsByKey } from '@/state/sessions';

export interface CanvasPrompt {
    id: string;
    subject: PromptSubject;
    title: string;
    provider: AgentKind | null;
    surface: 'chat' | 'terminal';
}

export interface CanvasPromptsInput {
    nodes: readonly Pick<CanvasNode, 'id' | 'kind' | 'title' | 'provider'>[];
    endpointId: string;
    sessions: SessionsByKey;
    chats: ChatsById;
    /* The cards of this machine about operating its apps; each belongs to the chat or terminal whose agent asks. */
    computer: readonly ComputerApproval[];
    /* When each waiting terminal was first seen waiting, by session key, as the previous call returned it. */
    waitingSince: ReadonlyMap<string, number>;
}

export interface CanvasPrompts {
    prompts: CanvasPrompt[];
    waitingSince: Map<string, number>;
}

/* The chat's pending requests, read from the structure a delta leaves alone. */
export const pendingPromptsOf = (chat: Pick<ChatState, 'structure' | 'order'> | undefined): PendingPrompt[] => {
    const pending: PendingPrompt[] = [];
    for (const id of chat?.order ?? []) {
        const item = chat?.structure[id];
        if ((item?.kind === 'approval' && item.decision === 'pending') || (item?.kind === 'question' && item.state === 'pending')) {
            pending.push(item);
        }
    }
    return pending;
};

/*
 * Everything the chats and terminals on one canvas are asking, in the order the stack shows them:
 * blocking prompts first, optional questions after, each oldest first, the same rule a chat follows.
 * A waiting terminal is dated by when it was first seen waiting rather than by the agent's
 * `updatedAt`, which every later hook of the same prompt moves forward.
 */
export const canvasPrompts = ({ nodes, endpointId, sessions, chats, computer, waitingSince }: CanvasPromptsInput): CanvasPrompts => {
    const prompts: CanvasPrompt[] = [];
    const since = new Map(waitingSince);
    const add = (node: CanvasPromptsInput['nodes'][number], subject: PromptSubject, provider: AgentKind | null, surface: CanvasPrompt['surface']) =>
        prompts.push({ id: promptIdOf(subject), subject, title: node.title, provider, surface });
    for (const node of nodes) {
        const key = endpointKey(endpointId, node.id);
        if (node.kind === 'chat' || node.kind === 'terminal') {
            const provider = (node.kind === 'chat' ? chats[key]?.info.provider : sessions[key]?.agent?.kind) ?? node.provider ?? null;
            for (const request of computer) {
                if (request.nodeId === node.id) {
                    add(node, { kind: 'computer-approval', nodeId: node.id, request }, provider, node.kind);
                }
            }
        }
        if (node.kind === 'chat') {
            const chat = chats[key];
            for (const item of pendingPromptsOf(chat)) {
                add(node, { kind: 'chat', nodeId: node.id, item }, chat?.info.provider ?? node.provider ?? null, 'chat');
            }
            continue;
        }
        if (node.kind !== 'terminal') {
            continue;
        }
        const session = sessions[key];
        const provider = session?.agent?.kind ?? node.provider ?? null;
        const waiting = nodeStatus(node, sessions, chats, endpointId) === 'needs-you';
        if (!waiting) {
            since.delete(key);
            continue;
        }
        const first = since.get(key) ?? session?.agent?.updatedAt ?? 0;
        since.set(key, first);
        add(node, { kind: 'terminal-waiting', nodeId: node.id, since: first }, provider, 'terminal');
    }
    return {
        prompts: orderPrompts(
            prompts,
            (prompt) => isBlockingSubject(prompt.subject),
            (prompt) => promptCreatedAt(prompt.subject)
        ),
        waitingSince: since
    };
};

/*
 * The prompt in front of a stack. The one being read stays there whatever arrives; once it is
 * answered the prompt that moved into its place follows, so a card skipped with the arrows stays skipped.
 */
export const stackFront = (ids: readonly string[], activeId: string | null, lastIndex: number): string | null => {
    if (activeId !== null && ids.includes(activeId)) {
        return activeId;
    }
    if (ids.length === 0) {
        return null;
    }
    return ids[Math.min(Math.max(lastIndex, 0), ids.length - 1)]!;
};

const payloadOf = (subject: PromptSubject): unknown => {
    switch (subject.kind) {
        case 'chat':
            return subject.item;
        case 'computer-approval':
            return subject.request;
        case 'terminal-waiting':
            return subject.since;
    }
};

/* Whether a new reading draws the same stack, so a word streaming into a chat does not redraw its cards. */
export const samePrompts = (a: readonly CanvasPrompt[], b: readonly CanvasPrompt[]): boolean =>
    a.length === b.length &&
    a.every((prompt, i) => {
        const other = b[i]!;
        return (
            prompt.id === other.id &&
            prompt.title === other.title &&
            prompt.provider === other.provider &&
            prompt.subject.kind === other.subject.kind &&
            payloadOf(prompt.subject) === payloadOf(other.subject)
        );
    });
