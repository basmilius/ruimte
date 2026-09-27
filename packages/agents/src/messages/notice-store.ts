import { join } from 'node:path';
import { z } from 'zod';
import { errorText } from '../error-text.ts';
import { RecordDirectory } from '../record-directory.ts';

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
     * other. Absent is unshown, so a message left by an older host is still shown once.
     */
    shown: z.boolean().optional()
});

export type Notice = z.infer<typeof NoticeSchema>;

/* A queue waits in the file of the node it is for, so the first message in it names that node. */
const FileSchema = z.object({ notices: z.array(NoticeSchema).min(1) });

type NoticeFile = z.infer<typeof FileSchema>;

/*
 * The messages waiting for each node, held until that node's agent has a moment to hear them, under
 * `<dataDir>/notices`. On disk because the receiver may well be a node nobody has mounted yet, and a
 * host that restarts must not lose what was left for it. Delivered once, whichever channel gets there
 * first.
 */
export class NoticeStore {
    readonly dir: string;
    private readonly queues: RecordDirectory<NoticeFile>;
    private readonly now: () => number;
    private lastDrop: Promise<void> = Promise.resolve();

    constructor(dataDir: string, now: () => number = Date.now) {
        this.dir = join(dataDir, 'notices');
        this.now = now;
        this.queues = new RecordDirectory({
            dir: this.dir,
            schema: FileSchema,
            idOf: (file) => file.notices[0]!.targetId,
            // What went stale while the host was down is not delivered; a queue of nothing else goes.
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
