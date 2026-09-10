import { mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatInfoSchema, ChatItemSchema, type ChatInfo, type ChatItem } from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';
import { migrateInlineAttachments, type AttachmentStore } from './attachment-store.ts';

// zod strips what it does not know, so a file written by an older build (with `interactionMode`,
// say) still parses and loses only the dropped field.
const RecordSchema = z.object({ info: ChatInfoSchema, items: z.array(ChatItemSchema) });
type ChatRecord = z.infer<typeof RecordSchema>;

const fileName = (chatId: string): string => `${encodeURIComponent(chatId)}.json`;

/* One JSON file per chat under `$RUIMTE_HOME/chats`, written while a turn runs and on shutdown. */
export class ChatStore {
    readonly dir: string;
    private readonly attachments: AttachmentStore | null;

    constructor(home: string, attachments: AttachmentStore | null = null) {
        this.dir = join(home, 'chats');
        this.attachments = attachments;
    }

    /* Answers how many bytes the record took, which is what tells a caller whether writing it is cheap. */
    async write(chatId: string, info: ChatInfo, items: ChatItem[]): Promise<number> {
        const body = JSON.stringify({ info, items });
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(chatId)), body);
        return body.length;
    }

    /*
     * The same write without a turn of the event loop. A `bun --watch` reload restarts the module
     * before an awaited write comes back, so a shutdown has to put the threads down synchronously.
     */
    writeSync(chatId: string, info: ChatInfo, items: ChatItem[]): void {
        const target = join(this.dir, fileName(chatId));
        const temp = `${target}.${process.pid}.tmp`;
        mkdirSync(this.dir, { recursive: true, mode: 0o700 });
        writeFileSync(temp, JSON.stringify({ info, items }), { mode: 0o600 });
        renameSync(temp, target);
    }

    async read(chatId: string): Promise<ChatRecord | null> {
        let raw: string;
        try {
            raw = await readFile(join(this.dir, fileName(chatId)), 'utf8');
        } catch (e) {
            if (isNotFound(e)) {
                return null;
            }
            throw e;
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
                await writeAtomic(join(this.dir, fileName(chatId)), JSON.stringify(migrated));
            }
        }
        const parsed = RecordSchema.safeParse(record);
        return parsed.success ? parsed.data : null;
    }

    async delete(chatId: string): Promise<void> {
        await rm(join(this.dir, fileName(chatId)), { force: true });
    }
}
