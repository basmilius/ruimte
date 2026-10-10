import { deliverToChat, type ChatDelivery, type ChatNoticeTargets, type MessageWords } from '@adecore/agents/messages/deliver-notice';
import type { Notice, NoticeStore } from '@adecore/agents/messages/notice-store';
import type { AgentInfo } from '@ruimte/contracts';
import { takesHookContext } from '../agents/hooks.ts';

export { MAX_NOTICE_LENGTH } from '@ruimte/actions';

/* What the receiving agent hears: the id to act on, the title to read, and the message itself. */
export function renderNotice(notice: Notice): string {
    return `Ruimte: node ${notice.from}${notice.fromTitle === '' ? '' : ` ("${notice.fromTitle}")`} sent you a message: ${notice.text}`;
}

/* What a person reads in the thread: the sender by its name on the canvas, and no id to act on. */
export function noticeNote(notice: Notice): string {
    return `${notice.fromTitle === '' ? `Node ${notice.from}` : notice.fromTitle} sent a message: ${notice.text}`;
}

/*
 * What the CLI is sent under the messages in the preamble. The last sentence is the rule the daemon
 * enforces; without it an agent answers and then waits for a reply that never comes on its own.
 */
export function messageText(count: number): string {
    return `${count === 1 ? 'A node linked to you sent you the message above' : `${count} nodes linked to you sent you the messages above`}. Act on it, and answer with ruimte-context notify if you were asked something. A message starts one turn and no further: what you send from this turn is read by that node at the start of its next one.`;
}

/* What a person reads above the turn in the thread: who it came from, by the name they see on the canvas. */
export function messageLabel(notices: readonly Notice[]): string {
    const names = [...new Set(notices.map((notice) => (notice.fromTitle === '' ? `node ${notice.from}` : notice.fromTitle)))];
    return names.length === 1 ? `Message from ${names[0]}` : `Messages from ${names.join(', ')}`;
}

export const MESSAGE_WORDS: MessageWords = { heard: renderNotice, shown: noticeNote, prompt: messageText, label: messageLabel };

/* Where a message went: onto a screen now, into a turn the chat is owed, or into a queue it waits in. */
export interface NoticeDelivery {
    at: 'now' | 'waiting';
    detail: string;
    /* Whether the receiving chat is owed a turn on this message; the daemon's outbox is what opens it. */
    wake: boolean;
}

// Without this tail on every answer to a notify, a model polls the node it wrote to until it gives up.
export const NO_REPLY_NOTICE = 'nothing comes back to you, and ruimte-context task new is what brings a result back';

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
            return delivered('waiting', false, `that chat is in a turn; it reads the message in front of its next one (${count})`);
        case 'from-message':
            return delivered(
                'waiting',
                false,
                `a message started the turn you are in, and a message starts one turn and no further; that chat reads this one in front of its next turn (${count})`
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
