import { mkdir, readdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { z } from 'zod';
import type { AgentInfo } from '@ruimte/contracts';
import { takesHookContext } from '../agents/hooks.ts';
import { isNotFound, writeAtomic } from '../fs.ts';

/*
 * A message is a line or two an agent reads in front of its next turn, not a document. Anything
 * longer belongs in a note on the canvas, which the agent can be linked to and read whole.
 */
export const MAX_NOTICE_LENGTH = 500;

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
    createdAt: z.number()
});

export type Notice = z.infer<typeof NoticeSchema>;

const FileSchema = z.object({ notices: z.array(NoticeSchema) });

// The id is a node id the client chose, so it is encoded before it becomes a file name.
const fileName = (targetId: string): string => `${encodeURIComponent(targetId)}.json`;

/* What the receiving agent hears: the id to act on, the title to read, and the message itself. */
export const renderNotice = (notice: Notice): string =>
    `Ruimte: node ${notice.from}${notice.fromTitle === '' ? '' : ` ("${notice.fromTitle}")`} sent you a message: ${notice.text}`;

/*
 * The messages waiting for each node, held until that node's agent has a moment to hear them. On
 * disk beside the pending prompts and the lineage, for the same reason: the receiver may well be a
 * node nobody has mounted yet, and a daemon that restarts must not lose what was left for it.
 * Delivered once, whichever channel gets there first.
 */
export class NoticeStore {
    readonly dir: string;
    private readonly queues = new Map<string, Notice[]>();
    private readonly now: () => number;
    private lastDrop: Promise<void> = Promise.resolve();

    constructor(home: string, now: () => number = Date.now) {
        this.dir = join(home, 'notices');
        this.now = now;
    }

    /* Reads what an earlier run of the daemon was still holding. Call before anything can take one. */
    async load(): Promise<void> {
        let names: string[];
        try {
            names = await readdir(this.dir);
        } catch (e) {
            if (isNotFound(e)) {
                return;
            }
            throw e;
        }
        for (const name of names) {
            if (!name.endsWith('.json')) {
                continue;
            }
            const raw = await readFile(join(this.dir, name), 'utf8').catch(() => null);
            if (raw === null) {
                continue;
            }
            let parsed: ReturnType<typeof FileSchema.safeParse>;
            try {
                parsed = FileSchema.safeParse(JSON.parse(raw));
            } catch {
                continue;
            }
            const fresh = parsed.success ? parsed.data.notices.filter((notice) => this.fresh(notice)) : [];
            const targetId = fresh[0]?.targetId;
            if (targetId === undefined) {
                await rm(join(this.dir, name), { force: true });
                continue;
            }
            this.queues.set(targetId, fresh);
        }
    }

    /* Puts one message in a node's queue and answers how many now wait for it. */
    async put(notice: Omit<Notice, 'createdAt'>): Promise<number> {
        const queue = [...this.waiting(notice.targetId), { ...notice, createdAt: this.now() }].slice(-MAX_NOTICES);
        this.queues.set(notice.targetId, queue);
        await this.persist(notice.targetId);
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
        this.queues.delete(targetId);
        this.lastDrop = this.persist(targetId).catch((e) => console.error(`Dropping the messages of ${targetId} failed`, e));
        return queue;
    }

    /* Resolves once the file the last `take` dropped is gone; `take` cannot hand that promise back itself. */
    settled(): Promise<void> {
        return this.lastDrop;
    }

    /* What waits for a node, without taking it; the stale ones are already gone from the answer. */
    waiting(targetId: string): Notice[] {
        const queue = this.queues.get(targetId);
        if (queue === undefined) {
            return [];
        }
        return queue.filter((notice) => this.fresh(notice));
    }

    /* Drops what a project was holding for ids it no longer has: the node was deleted before it read them. */
    async prune(projectId: string, ids: ReadonlySet<string>): Promise<void> {
        for (const [targetId, queue] of [...this.queues]) {
            if (queue[0]?.projectId === projectId && !ids.has(targetId)) {
                this.queues.delete(targetId);
                await this.persist(targetId);
            }
        }
    }

    private fresh(notice: Notice): boolean {
        return this.now() - notice.createdAt < NOTICE_MAX_AGE_MS;
    }

    private async persist(targetId: string): Promise<void> {
        const queue = this.queues.get(targetId) ?? [];
        if (queue.length === 0) {
            await rm(join(this.dir, fileName(targetId)), { force: true });
            return;
        }
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(targetId)), JSON.stringify({ notices: queue }));
    }
}

/* Where a message went: onto a screen now, or into the queue of an agent that is busy or not there yet. */
export interface NoticeDelivery {
    at: 'now' | 'waiting';
    detail: string;
}

export interface NoticeTargets {
    /* The terminal running under this node id, when the daemon has one that has not exited. */
    terminal(id: string): { agent: AgentInfo | null; notice(text: string): void } | null;
    /* Whether a chat runs under this id; a chat hears a message in front of its next prompt. */
    hasChat(id: string): boolean;
}

/*
 * One message on its way to a node. An agent that answers a context hook is the only kind that can
 * be handed something between two turns, so its message waits for that turn. Everything else gets
 * the line on the screen, which is what the motd already does: never typed into the PTY, since the
 * shell must not read a byte nobody typed.
 */
export const deliverNotice = async (store: NoticeStore, targets: NoticeTargets, notice: Omit<Notice, 'createdAt'>): Promise<NoticeDelivery> => {
    const terminal = targets.terminal(notice.targetId);
    const agent = terminal?.agent ?? null;
    if (terminal && !(agent?.live === true && takesHookContext(agent.kind))) {
        terminal.notice(renderNotice({ ...notice, createdAt: Date.now() }));
        return {
            at: 'now',
            detail:
                agent?.live === true
                    ? `printed on its screen; ${agent.kind} takes nothing between its turns, so its agent may not read it`
                    : 'printed on the screen of that terminal'
        };
    }
    const waiting = await store.put(notice);
    const count = waiting === 1 ? '1 waiting' : `${waiting} waiting`;
    if (terminal) {
        return { at: 'waiting', detail: `its agent reads it at the start of its next turn (${count})` };
    }
    if (targets.hasChat(notice.targetId)) {
        return { at: 'waiting', detail: `the chat reads it in front of its next prompt (${count})` };
    }
    return { at: 'waiting', detail: `nothing runs in that node yet; it reads the message when it starts (${count})` };
};
