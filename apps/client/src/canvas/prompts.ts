import {
    CHAT_REQUEST_LIMITS,
    designNodeChats,
    type AgentKind,
    type ChatApprovalItem,
    type ChatQuestionItem,
    type ComputerApproval,
    type ProjectProposal,
    type SecretRequest
} from '@ruimte/contracts';
import { orderPrompts, isBlockingSubject, promptCreatedAt, promptIdOf, type PromptSubject } from '@adecore/agents-react/prompts';
import type { CanvasNode } from '@/state/canvas';
import { waitingRequestsOf, type ChatsById, type ChatState } from '@adecore/agents-react/state';
import { endpointKey, endpointOfNode } from '@/state/keys';
import { computerPrompt, proposalPrompt, ruimtePayloadOf, secretPrompt, waitingPrompt } from '@/prompts/ruimte-prompts';
import { nodeStatus, type SessionsByKey } from '@/state/sessions';

export interface CanvasPrompt {
    id: string;
    subject: PromptSubject;
    sourceNodeId?: string;
    title: string;
    provider: AgentKind | null;
    surface: 'chat' | 'terminal';
}

export interface CanvasPromptsInput {
    nodes: readonly Pick<CanvasNode, 'id' | 'kind' | 'title' | 'provider' | 'machine' | 'chats'>[];
    endpointId: string;
    sessions: SessionsByKey;
    chats: ChatsById;
    descendants?: ReadonlyMap<string, readonly PromptSubject[]>;
    /* The cards about operating apps, of this machine and of every other one a node runs on; each belongs to the chat or terminal whose agent asks. */
    computer: readonly ComputerApproval[];
    /* The cards in which an agent asks for a launch's secret, the same way; each belongs to the chat that asks. */
    secrets?: readonly SecretRequest[];
    /* The suggestions of agents in Chats to become a project, the same way; each belongs to the chat that suggests. */
    proposals?: readonly ProjectProposal[];
    /* When each waiting terminal was first seen waiting, by session key, as the previous call returned it. */
    waitingSince: ReadonlyMap<string, number>;
}

export interface CanvasPrompts {
    prompts: CanvasPrompt[];
    waitingSince: Map<string, number>;
}

/*
 * Everything the chats and terminals on one canvas are asking, in the order the stack shows them:
 * blocking prompts first, optional questions after, each oldest first, the same rule a chat follows.
 * A waiting terminal is dated by when it was first seen waiting rather than by the agent's
 * `updatedAt`, which every later hook of the same prompt moves forward.
 */
export function canvasPrompts({
    nodes,
    endpointId,
    sessions,
    chats,
    descendants,
    computer,
    secrets = [],
    proposals = [],
    waitingSince
}: CanvasPromptsInput): CanvasPrompts {
    const prompts: CanvasPrompt[] = [];
    const since = new Map(waitingSince);
    const add = (node: CanvasPromptsInput['nodes'][number], subject: PromptSubject, provider: AgentKind | null, surface: CanvasPrompt['surface']) =>
        prompts.push({ id: promptIdOf(subject), subject, title: node.title, provider, surface });
    // A design node asks as each of its chats, the one under its own id and every later one.
    const asked = nodes.flatMap((node): CanvasPromptsInput['nodes'][number][] =>
        node.kind === 'design'
            ? [
                  { ...node, kind: 'chat' },
                  ...designNodeChats(node).map((chat) => ({ ...node, id: chat.id, kind: 'chat' as const, title: chat.name, provider: chat.node.provider }))
              ]
            : [node]
    );
    for (const node of asked) {
        if (node.kind !== 'chat' && node.kind !== 'terminal') {
            continue;
        }
        const machine = endpointOfNode(node, endpointId);
        const key = endpointKey(machine, node.id);
        const provider = (node.kind === 'chat' ? chats[key]?.info.provider : sessions[key]?.agent?.kind) ?? node.provider ?? null;
        for (const request of computer) {
            if (request.nodeId === node.id) {
                add(node, { kind: 'host', nodeId: node.id, prompt: computerPrompt(node.id, request) }, provider, node.kind);
            }
        }
        if (node.kind === 'chat') {
            for (const request of secrets) {
                if (request.nodeId === node.id) {
                    add(node, { kind: 'host', nodeId: node.id, prompt: secretPrompt(machine, node.id, request) }, provider, 'chat');
                }
            }
            for (const proposal of proposals) {
                if (proposal.chatId === node.id) {
                    add(node, { kind: 'host', nodeId: node.id, prompt: proposalPrompt(machine, node.id, proposal) }, provider, 'chat');
                }
            }
            for (const item of standingRequestsOf(chats[key])) {
                add(node, { kind: 'chat', nodeId: node.id, item }, provider, 'chat');
            }
            for (const subject of descendants?.get(key) ?? []) {
                if (subject.kind === 'chat' && subject.nodeId !== node.id) {
                    prompts.push({
                        id: promptIdOf(subject),
                        subject,
                        sourceNodeId: node.id,
                        title: node.title,
                        provider: subject.source?.provider ?? provider,
                        surface: 'chat'
                    });
                }
            }
            continue;
        }
        const session = sessions[key];
        const waiting = nodeStatus(node, sessions, chats, endpointId) === 'needs-you';
        if (!waiting) {
            since.delete(key);
            continue;
        }
        const first = since.get(key) ?? session?.agent?.updatedAt ?? 0;
        since.set(key, first);
        const requests = session?.agent?.requests ?? [];
        if (requests.length === 0) {
            add(node, { kind: 'host', nodeId: node.id, prompt: waitingPrompt(node.id, first) }, provider, 'terminal');
        } else {
            for (const request of requests) {
                add(node, { kind: 'host', nodeId: node.id, prompt: waitingPrompt(node.id, request.createdAt, request) }, provider, 'terminal');
            }
        }
    }
    return {
        prompts: orderPrompts(
            prompts.filter((prompt, index) => prompts.findIndex((other) => other.id === prompt.id) === index),
            (prompt) => isBlockingSubject(prompt.subject),
            (prompt) => promptCreatedAt(prompt.subject)
        ),
        waitingSince: since
    };
}

/*
 * The requests a chat's thread holds as waiting, as far as its status agrees. The status reaches every
 * client on each change; the thread only one attached to it, so a chat whose node went out of view (a
 * collapsed group, a closed cell) keeps whatever waited when it detached, answered or not.
 */
export function standingRequestsOf(chat: ChatState | undefined): Array<ChatApprovalItem | ChatQuestionItem> {
    const requests = waitingRequestsOf(chat);
    if (chat === undefined || requests.length === 0) {
        return requests;
    }
    if (chat.info.status !== 'needs-you') {
        return [];
    }
    const listed = chat.info.requests;
    // A machine that lists none is older, and a full list may leave out the newest.
    if (listed === undefined || listed.length >= CHAT_REQUEST_LIMITS.perChat) {
        return requests;
    }
    const open = new Set(listed.map((request) => request.requestId));
    return requests.filter((request) => open.has(request.requestId));
}

/*
 * The prompt in front of a stack. The one being read stays there whatever arrives; once it is
 * answered the prompt that moved into its place follows, so a card skipped with the arrows stays skipped.
 */
export function stackFront(ids: readonly string[], activeId: string | null, lastIndex: number): string | null {
    if (activeId !== null && ids.includes(activeId)) {
        return activeId;
    }
    if (ids.length === 0) {
        return null;
    }
    return ids[Math.min(Math.max(lastIndex, 0), ids.length - 1)]!;
}

/* Whether a new reading draws the same stack, so a word streaming into a chat does not redraw its cards. */
export function samePrompts(a: readonly CanvasPrompt[], b: readonly CanvasPrompt[]): boolean {
    return (
        a.length === b.length &&
        a.every((prompt, i) => {
            const other = b[i]!;
            return (
                prompt.id === other.id &&
                prompt.title === other.title &&
                prompt.sourceNodeId === other.sourceNodeId &&
                prompt.provider === other.provider &&
                prompt.subject.kind === other.subject.kind &&
                (prompt.subject.kind !== 'chat' ||
                    other.subject.kind !== 'chat' ||
                    (prompt.subject.item === other.subject.item && prompt.subject.source?.label === other.subject.source?.label)) &&
                ruimtePayloadOf(prompt.subject) === ruimtePayloadOf(other.subject)
            );
        })
    );
}
