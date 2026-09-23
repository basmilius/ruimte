import { join } from 'node:path';
import { RecordDirectory } from '../record-directory.ts';
import { z } from 'zod';
import type { AgentInfo } from '@ruimte/contracts';
import { takesHookContext } from '../agents/hooks.ts';
import { errorText } from '../error-text.ts';

export { MAX_NOTICE_LENGTH } from '@ruimte/actions';

// Per receiver. Past this the oldest goes: an agent in a loop must not fill a queue nobody reads.
export const MAX_NOTICES = 10;

/*
 * A message nobody picked up in this long is dropped rather than delivered. It is news about work
 * happening now ("the build is green"), and a model reading it six hours late would act on
 * something that has moved on. The cap alone would not do it: one message in a queue of one waits
 * for ever.
 */
export const NOTICE_MAX_AGE_MS = 6 * 60 * 60 * 1000;

const NoticeSchema = z.object({
    projectId: z.string().min(1),
    /* The node the message is for; also the file it waits in. */
    targetId: z.string().min(1),
    /* The node that sent it, by id, since that is what the receiver can act on. */
    from: z.string().min(1),
    fromTitle: z.string(),
    text: z.string().min(1),
    createdAt: z.number(),
    /*
     * Whether a person was shown this message already. Its own mark, beside the queue: the queue is
     * emptied by the model reading the message, and the two readers must not take it from each
     * other. Absent is unshown, so a message left by an older daemon is still shown once.
     */
    shown: z.boolean().optional()
});

export type Notice = z.infer<typeof NoticeSchema>;

/* A queue waits in the file of the node it is for, so the first message in it names that node. */
const FileSchema = z.object({ notices: z.array(NoticeSchema).min(1) });

type NoticeFile = z.infer<typeof FileSchema>;

/* What the receiving agent hears: the id to act on, the title to read, and the message itself. */
export const renderNotice = (notice: Notice): string =>
    `Ruimte: node ${notice.from}${notice.fromTitle === '' ? '' : ` ("${notice.fromTitle}")`} sent you a message: ${notice.text}`;

/*
 * What a person reads in the thread: the sender by the name it carries on the canvas, since that is
 * what they can point at, and the message whole. Not what the agent hears: this one is addressed to
 * nobody and names no id to act on.
 */
export const noticeNote = (notice: Notice): string => `${notice.fromTitle === '' ? `Node ${notice.from}` : notice.fromTitle} sent a message: ${notice.text}`;

/*
 * The messages waiting for each node, held until that node's agent has a moment to hear them. On
 * disk beside the pending prompts and the lineage, for the same reason: the receiver may well be a
 * node nobody has mounted yet, and a daemon that restarts must not lose what was left for it.
 * Delivered once, whichever channel gets there first.
 */
export class NoticeStore {
    readonly dir: string;
    private readonly queues: RecordDirectory<NoticeFile>;
    private readonly now: () => number;
    private lastDrop: Promise<void> = Promise.resolve();

    constructor(home: string, now: () => number = Date.now) {
        this.dir = join(home, 'notices');
        this.now = now;
        this.queues = new RecordDirectory({
            dir: this.dir,
            schema: FileSchema,
            idOf: (file) => file.notices[0]!.targetId,
            // What went stale while the daemon was down is not delivered; a queue of nothing else goes.
            keep: (file) => {
                const fresh = file.notices.filter((notice) => this.fresh(notice));
                return fresh[0] === undefined ? null : { notices: fresh };
            }
        });
    }

    load(): Promise<void> {
        return this.queues.load();
    }

    /* Puts one message in a node's queue and answers how many now wait for it. */
    async put(notice: Omit<Notice, 'createdAt'>): Promise<number> {
        const queue = [...this.waiting(notice.targetId), { ...notice, createdAt: this.now() }].slice(-MAX_NOTICES);
        await this.persist(notice.targetId, queue);
        return queue.length;
    }

    /*
     * Everything waiting for a node, gone the moment it is asked for. Synchronous, because the
     * callers are: a shell's first screen and a hook's answer are both written before anything can
     * be awaited. The queue leaves memory first and the file follows, so two channels asking in the
     * same tick cannot both be handed the same message.
     */
    take(targetId: string): Notice[] {
        const queue = this.waiting(targetId);
        if (queue.length === 0) {
            return [];
        }
        this.lastDrop = this.persist(targetId, []).catch((e) => console.error(`Dropping the messages of ${targetId} failed:`, errorText(e)));
        return queue;
    }

    /* Resolves once the file the last `take` dropped is gone; `take` cannot hand that promise back itself. */
    settled(): Promise<void> {
        return this.lastDrop;
    }

    /*
     * What nobody showed a person yet, marked here so it is shown once. The messages stay in the
     * queue: this is the second reader, and only the model's copy may be taken away.
     */
    async show(targetId: string): Promise<Notice[]> {
        const queue = this.waiting(targetId);
        const unshown = queue.filter((notice) => notice.shown !== true);
        if (unshown.length === 0) {
            return [];
        }
        await this.persist(
            targetId,
            queue.map((notice) => ({ ...notice, shown: true }))
        );
        return unshown;
    }

    /* What waits for a node, without taking it; the stale ones are already gone from the answer. */
    waiting(targetId: string): Notice[] {
        const file = this.queues.get(targetId);
        if (file === undefined) {
            return [];
        }
        return file.notices.filter((notice) => this.fresh(notice));
    }

    /* Drops what a project was holding for ids it no longer has: the node was deleted before it read them. */
    prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        return this.queues.prune((file) => file.notices[0]!.projectId === projectId && !ids.has(file.notices[0]!.targetId));
    }

    private fresh(notice: Notice): boolean {
        return this.now() - notice.createdAt < NOTICE_MAX_AGE_MS;
    }

    /* The queue of one node, emptied here and on disk both; an empty one leaves no file behind. */
    private async persist(targetId: string, queue: Notice[]): Promise<void> {
        if (queue.length === 0) {
            await this.queues.remove(targetId);
            return;
        }
        await this.queues.write({ notices: queue });
    }
}

/* Where a message went: onto a screen now, into a turn the chat is owed, or into a queue it waits in. */
export interface NoticeDelivery {
    at: 'now' | 'waiting';
    detail: string;
    /* Whether the receiving chat is owed a turn on this message; the daemon's outbox is what opens it. */
    wake: boolean;
}

/*
 * The tail of every answer to a notify. The sender reads it at the one moment it decides whether to
 * wait for something back, and nothing here ever sends it one: without this a model polls the node
 * it wrote to until it gives up.
 */
export const NO_REPLY_NOTICE = 'nothing comes back to you, and ruimte-context task new is what brings a result back';

/* One delivery line: where the message went, and the tail that says not to wait for an answer. */
const delivered = (at: NoticeDelivery['at'], wake: boolean, detail: string): NoticeDelivery => ({ at, wake, detail: `${detail}; ${NO_REPLY_NOTICE}` });

export interface NoticeTargets {
    /* The terminal running under this node id, when the daemon has one that has not exited. */
    terminal(id: string): { agent: AgentInfo | null; notice(text: string): void } | null;
    /* What the daemon holds under this id: a chat between turns, one that is in a turn, or no chat at all. */
    chat(id: string): Promise<'idle' | 'running' | 'none'>;
    /* Whether the turn this node is running was opened by a message of its own, which is where waking stops. */
    fromMessage(id: string): boolean;
}

/*
 * One message on its way to a node, and whether the receiver owes a turn on it. A chat between turns
 * gets one, the way a settled task gives one: a person watching two agents cannot tell a message from
 * an assignment, and a message nobody starts a turn for sits there until someone happens to prompt
 * that chat. One step deep, so the turn a message opened wakes nobody with a message of its own.
 *
 * A terminal keeps what it always did. Starting a turn there means typing into the shell a person
 * types in, so an agent that answers a context hook hears the message at the start of the next turn
 * it takes itself, and every other terminal gets the line on its screen, which is what the motd does.
 */
export const deliverNotice = async (store: NoticeStore, targets: NoticeTargets, notice: Omit<Notice, 'createdAt'>): Promise<NoticeDelivery> => {
    const terminal = targets.terminal(notice.targetId);
    const agent = terminal?.agent ?? null;
    if (terminal && !(agent?.live === true && takesHookContext(agent.kind))) {
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
    const count = waiting === 1 ? '1 waiting' : `${waiting} waiting`;
    if (terminal) {
        return delivered('waiting', false, `its agent reads it at the start of its next turn, which nothing here starts (${count})`);
    }
    const chat = await targets.chat(notice.targetId);
    if (chat === 'none') {
        return delivered('waiting', false, `nothing runs in that node yet; it reads the message when it starts (${count})`);
    }
    if (chat === 'running') {
        return delivered('waiting', false, `that chat is in a turn; it reads the message in front of its next one (${count})`);
    }
    if (targets.fromMessage(notice.from)) {
        return delivered(
            'waiting',
            false,
            `a message started the turn you are in, and a message starts one turn and no further; that chat reads this one in front of its next turn (${count})`
        );
    }
    return delivered('now', true, 'that chat takes a turn on it, and reads it there');
};

/* The chat a message was left for, as the two things showing it needs: whether it is there, and a line in its thread. */
export interface NoticeChat {
    /* Whether this daemon holds a chat under the id, running or on disk. */
    has(id: string): Promise<boolean>;
    /* Puts a line in that chat's thread, loading the chat when nobody has. */
    note(id: string, text: string): Promise<void>;
}

/*
 * What a chat has to show a person, in its thread, the moment a message lands and not when the model
 * gets round to it: without this a message left for a busy node is a file under $RUIMTE_HOME and
 * nothing else. An id no chat holds shows nothing and marks nothing, so the chat that opens on that
 * id later still has all of it.
 */
export const showNotices = async (store: NoticeStore, chat: NoticeChat, targetId: string): Promise<void> => {
    if (!(await chat.has(targetId))) {
        return;
    }
    for (const notice of await store.show(targetId)) {
        await chat.note(targetId, noticeNote(notice));
    }
};
