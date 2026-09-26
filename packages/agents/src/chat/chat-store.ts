import { mkdirSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatInfoSchema, ChatItemSchema, type ChatInfo, type ChatItem } from '@ruimte/agent-contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic, writeAtomicSync } from '../fs.ts';
import { isBookmarkFileName } from './bookmark-store.ts';
import { migrateInlineAttachments, type AttachmentStore } from './attachment-store.ts';
import { parseLog, type ChatLogLine } from './chat-log.ts';
import { ChatThread } from './thread.ts';
import { recordFileName } from '../record-directory.ts';

// zod strips what it does not know inside the info and the items, so a file written by an older build
// (with `interactionMode`, say) still parses and loses only the dropped field. A record without `seq`
// predates the log. Keys beside these are the host's own, and come back to it as they were written.
const RecordSchema = z.looseObject({
    info: ChatInfoSchema,
    items: z.array(ChatItemSchema),
    seq: z.number().int().nonnegative().optional(),
    resetSeq: z.number().int().nonnegative().optional(),
    // Never on the wire: what goes in front of the next real prompt, once (a fork's note for its agent).
    preambles: z.array(z.string()).optional()
});

const OWN_KEYS = new Set(['info', 'items', 'seq', 'resetSeq', 'preambles']);

/* What a host keeps in a chat's record beside the thread; it never reaches the wire. */
export type ChatRecordExtras = Record<string, unknown>;

const extrasOf = (record: Record<string, unknown>): ChatRecordExtras => Object.fromEntries(Object.entries(record).filter(([key]) => !OWN_KEYS.has(key)));

/* A thread as it stood when the daemon last wrote down anything about it: the snapshot with the log played over it. */
export interface ChatRecord {
    info: ChatInfo;
    items: ChatItem[];
    seq: number;
    resetSeq: number;
    preambles: string[];
    extras: ChatRecordExtras;
    // The log as it is on disk, for the lines an attach with `since` may still be answered from.
    lines: ChatLogLine[];
}

/* Where a snapshot stands in the chat's stream. */
export interface ChatSeq {
    seq: number;
    resetSeq: number;
}

const logName = (chatId: string): string => `${encodeURIComponent(chatId)}.log`;

const recordBody = (info: ChatInfo, items: ChatItem[], at: ChatSeq, preambles: readonly string[], extras: ChatRecordExtras): string =>
    JSON.stringify({ info, items, ...at, ...(preambles.length === 0 ? {} : { preambles }), ...withoutOwnKeys(extras) });

const withoutOwnKeys = (extras: ChatRecordExtras): ChatRecordExtras => Object.fromEntries(Object.entries(extras).filter(([key]) => !OWN_KEYS.has(key)));

export interface ChatStoreOptions {
    attachments?: AttachmentStore | null;
    // Files a host keeps beside a record under names that also end in .json (a chat's plans), which are no chats.
    isSidecar?(name: string): boolean;
}

/*
 * One JSON file per chat under `<home>/chats`, written while a turn runs and on shutdown, with
 * the log of what happened since beside it (`ChatLog` appends to it; reading plays it back).
 */
export class ChatStore {
    readonly dir: string;
    private readonly attachments: AttachmentStore | null;
    private readonly isSidecar: (name: string) => boolean;

    constructor(home: string, options: ChatStoreOptions = {}) {
        this.dir = join(home, 'chats');
        this.attachments = options.attachments ?? null;
        this.isSidecar = options.isSidecar ?? (() => false);
    }

    logPath(chatId: string): string {
        return join(this.dir, logName(chatId));
    }

    /* Every chat with a record or a log, for the scan at start. */
    async list(): Promise<string[]> {
        let names: string[];
        try {
            names = await readdir(this.dir);
        } catch (e) {
            if (isNotFound(e)) {
                return [];
            }
            throw e;
        }
        const ids = names
            // A chat's bookmarks, and whatever a host keeps per chat, sit beside its record under names that also end in .json.
            .filter((name) => (name.endsWith('.json') && !isBookmarkFileName(name) && !this.isSidecar(name)) || name.endsWith('.log'))
            .map((name) => decodeURIComponent(name.replace(/\.(json|log)$/, '')));
        return [...new Set(ids)];
    }

    /* Whether anything of the chat is on disk, without reading it: a record or a log. */
    async has(chatId: string): Promise<boolean> {
        const found = await Promise.all([exists(join(this.dir, recordFileName(chatId))), exists(this.logPath(chatId))]);
        return found.includes(true);
    }

    /* Removes a log no record can be made of and answers the last seq it handed out, zero without one. */
    async discardLog(chatId: string): Promise<number> {
        const lines = parseLog((await readOrNull(this.logPath(chatId))) ?? '');
        await rm(this.logPath(chatId), { force: true });
        return lines.at(-1)?.seq ?? 0;
    }

    /* Answers how many bytes the record took, which is what tells a caller whether writing it is cheap. */
    async write(
        chatId: string,
        info: ChatInfo,
        items: ChatItem[],
        at: ChatSeq = { seq: 0, resetSeq: 0 },
        preambles: readonly string[] = [],
        extras: ChatRecordExtras = {}
    ): Promise<number> {
        const body = recordBody(info, items, at, preambles, extras);
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, recordFileName(chatId)), body);
        return body.length;
    }

    /*
     * The same write without a turn of the event loop. A `bun --watch` reload restarts the module
     * before an awaited write comes back, so a shutdown has to put the threads down synchronously.
     */
    writeSync(
        chatId: string,
        info: ChatInfo,
        items: ChatItem[],
        at: ChatSeq = { seq: 0, resetSeq: 0 },
        preambles: readonly string[] = [],
        extras: ChatRecordExtras = {}
    ): void {
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        writeAtomicSync(join(this.dir, recordFileName(chatId)), recordBody(info, items, at, preambles, extras));
    }

    async read(chatId: string): Promise<ChatRecord | null> {
        const lines = parseLog((await readOrNull(this.logPath(chatId))) ?? '');
        const snapshot = await this.readSnapshot(chatId);
        if (snapshot === null) {
            return fromLogAlone(lines);
        }
        const seq = snapshot.seq ?? 0;
        const thread = new ChatThread(snapshot.info, snapshot.items);
        let resetSeq = snapshot.resetSeq ?? 0;
        for (const line of lines) {
            // A crash between writing a snapshot and folding the log into it leaves lines the snapshot already holds.
            if (line.seq <= seq) {
                continue;
            }
            thread.apply(line.event);
            if (line.event.type === 'reset') {
                resetSeq = line.seq;
            }
        }
        return { ...thread.snapshot(), seq, resetSeq, preambles: snapshot.preambles ?? [], extras: extrasOf(snapshot), lines };
    }

    private async readSnapshot(chatId: string): Promise<z.infer<typeof RecordSchema> | null> {
        const raw = await readOrNull(join(this.dir, recordFileName(chatId)));
        if (raw === null) {
            return null;
        }
        let record: unknown;
        try {
            record = JSON.parse(raw);
        } catch {
            return null;
        }
        // Before the schema sees it: an image written inline no longer has a shape the schema knows.
        if (this.attachments) {
            const migrated = await migrateInlineAttachments(chatId, record, this.attachments).catch(() => null);
            if (migrated !== null) {
                record = migrated;
                await writeAtomic(join(this.dir, recordFileName(chatId)), JSON.stringify(migrated));
            }
        }
        const parsed = RecordSchema.safeParse(record);
        return parsed.success ? parsed.data : null;
    }

    async delete(chatId: string): Promise<void> {
        await Promise.all([rm(join(this.dir, recordFileName(chatId)), { force: true }), rm(this.logPath(chatId), { force: true })]);
    }
}

const exists = async (path: string): Promise<boolean> => {
    try {
        await stat(path);
        return true;
    } catch (e) {
        if (isNotFound(e)) {
            return false;
        }
        throw e;
    }
};

const readOrNull = async (path: string): Promise<string | null> => {
    try {
        return await readFile(path, 'utf8');
    } catch (e) {
        if (isNotFound(e)) {
            return null;
        }
        throw e;
    }
};

/*
 * A chat whose first snapshot never reached the disk (the daemon went down within moments of its
 * first turn) is rebuilt from its log when the log starts at the beginning and says what the chat
 * is. Otherwise the chat starts over, and its stream goes on after the last seq the log handed out
 * with a reset marked there, so a client holding a seq from before cannot be answered from after.
 */
const fromLogAlone = (lines: ChatLogLine[]): ChatRecord | null => {
    if (lines.length === 0) {
        return null;
    }
    const first = lines.find((line) => line.event.type === 'info' || line.event.type === 'reset')?.event;
    if (lines[0]!.seq !== 1 || (first?.type !== 'info' && first?.type !== 'reset')) {
        return null;
    }
    const thread = new ChatThread(first.info);
    let resetSeq = 0;
    for (const line of lines) {
        thread.apply(line.event);
        if (line.event.type === 'reset') {
            resetSeq = line.seq;
        }
    }
    return { ...thread.snapshot(), seq: 0, resetSeq, preambles: [], extras: {}, lines };
};
