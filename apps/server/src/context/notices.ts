import { deliverToChat, MAX_MESSAGE_HOPS, type ChatDelivery, type ChatNoticeTargets, type MessageWords } from '@adecore/agents/coordination';
import type { Notice, NoticeStore } from '@adecore/agents/coordination';
import { isExternalActor, type AgentInfo } from '@ruimte/contracts';
import { takesHookContext } from '../agents/hooks.ts';
import type { NoticeDelivery } from '../canvas/host.ts';

/* What the receiving agent hears: the id to act on, the title to read, and the message itself. */
export function renderNotice(notice: Notice): string {
    return `Ruimte: node ${notice.from}${notice.fromTitle === '' ? '' : ` ("${notice.fromTitle}")`} sent you a message: ${notice.text}`;
}

/* What a person reads in the thread: the sender by its name on the canvas, and no id to act on. */
export function noticeNote(notice: Notice): string {
    return `${notice.fromTitle === '' ? `Node ${notice.from}` : notice.fromTitle} sent a message: ${notice.text}`;
}

/* Who sent the messages above: agents of this project, or the person's external MCP client by the name it signs with. */
function senders(count: number, notices: readonly Notice[]): string {
    const external = notices.filter((notice) => isExternalActor(notice.from));
    const agents = count - external.length;
    const above = count === 1 ? 'the message above' : 'the messages above';
    const fromAgents = agents === 1 ? 'Another agent of this project' : `${agents} agents of this project`;

    if (external.length === 0) {
        return `${fromAgents} sent you ${above}`;
    }

    const clients = `external MCP client ${[...new Set(external.map((notice) => `"${notice.fromTitle}"`))].join(', ')}`;

    return agents === 0 ? `The person's ${clients} sent you ${above}` : `${fromAgents} and the person's ${clients} sent you ${above}`;
}

/*
 * What the CLI is sent under the messages in the preamble. The last sentence is the rule the daemon
 * enforces; without it an agent answers and then waits for a reply that never comes on its own.
 */
export function messageText(count: number, notices: readonly Notice[] = []): string {
    return `${senders(count, notices)}. Act on it, and answer with notify if you were asked something. Agents reading each other wake each other a few times; past that a message waits until its node takes a turn for another reason, and the answer to your notify says so.`;
}

/* What a person reads above the turn in the thread: who it came from, by the name they see on the canvas. */
export function messageLabel(notices: readonly Notice[]): string {
    const names = [...new Set(notices.map((notice) => (notice.fromTitle === '' ? `node ${notice.from}` : notice.fromTitle)))];
    return names.length === 1 ? `Message from ${names[0]}` : `Messages from ${names.join(', ')}`;
}

export const MESSAGE_WORDS: MessageWords = { heard: renderNotice, shown: noticeNote, prompt: messageText, label: messageLabel };

// Without this tail on every answer to a notify, a model polls the node it wrote to until it gives up.
export const NO_REPLY_NOTICE = 'do not wait on it: an answer reaches you only as a message of its own, and task_new is what brings a result back';

function delivered(at: NoticeDelivery['at'], wake: boolean, detail: string): NoticeDelivery {
    return { at, wake, detail: `${detail}; ${NO_REPLY_NOTICE}` };
}

function waitingCount(waiting: number): string {
    return waiting === 1 ? '1 waiting' : `${waiting} waiting`;
}

/* What the sender reads about a message that went to a chat. */
function chatDelivered({ outcome, waiting }: ChatDelivery): NoticeDelivery {
    const count = waitingCount(waiting);
    switch (outcome) {
        case 'no-chat':
            return delivered('waiting', false, `nothing runs in that node yet; it reads the message when it starts (${count})`);
        case 'in-turn':
            return {
                ...delivered('waiting', false, `that chat is in a turn; it reads the message at the latest in a turn of its own when this one ends (${count})`),
                inTurn: true
            };
        case 'hop-limit':
            return delivered(
                'waiting',
                false,
                `this chain of messages has woken agents ${MAX_MESSAGE_HOPS} times, which is as far as messages go; that chat reads this one when it next takes a turn for another reason (${count})`
            );
        case 'wake':
            return delivered('now', true, 'that chat takes a turn on it, and reads it there');
    }
}

export interface NoticeTargets extends ChatNoticeTargets {
    /* The terminal running under this node id, when the daemon has one that has not exited. */
    terminal(id: string): { agent: AgentInfo | null; notice(text: string): void } | null;
}

/*
 * One message on its way to a node. A terminal is never woken, since that means typing into a
 * person's shell: an agent that answers a context hook hears it at the start of its next turn, and
 * every other terminal gets the line on its screen.
 */
export async function deliverNotice(store: NoticeStore, targets: NoticeTargets, notice: Omit<Notice, 'createdAt'>): Promise<NoticeDelivery> {
    const terminal = targets.terminal(notice.targetId);
    if (terminal === null) {
        return chatDelivered(await deliverToChat(store, targets, notice));
    }
    const agent = terminal.agent;
    if (!(agent?.live === true && takesHookContext(agent.kind))) {
        terminal.notice(renderNotice({ ...notice, createdAt: Date.now() }));
        return delivered(
            'now',
            false,
            agent?.live === true
                ? `printed on its screen; ${agent.kind} takes nothing between its turns, so its agent may not read it`
                : 'printed on the screen of that terminal'
        );
    }
    const waiting = await store.put(notice);
    return delivered('waiting', false, `its agent reads it at the start of its next turn, which nothing here starts (${waitingCount(waiting)})`);
}
