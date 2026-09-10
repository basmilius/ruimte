import { mkdir, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { ChatInfoSchema, ChatItemSchema, type ChatInfo, type ChatItem } from '@ruimte/contracts';
import { z } from 'zod';
import { isNotFound, writeAtomic } from '../fs.ts';

// zod strips what it does not know, so a file written by an older build (with `interactionMode`,
// say) still parses and loses only the dropped field.
const RecordSchema = z.object({ info: ChatInfoSchema, items: z.array(ChatItemSchema) });
type ChatRecord = z.infer<typeof RecordSchema>;

const fileName = (chatId: string): string => `${encodeURIComponent(chatId)}.json`;

/* One JSON file per chat under `$RUIMTE_HOME/chats`, written after every turn and on shutdown. */
export class ChatStore {
    readonly dir: string;

    constructor(home: string) {
        this.dir = join(home, 'chats');
    }

    async write(chatId: string, info: ChatInfo, items: ChatItem[]): Promise<void> {
        await mkdir(this.dir, { recursive: true, mode: 0o700 });
        await writeAtomic(join(this.dir, fileName(chatId)), JSON.stringify({ info, items }));
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
        try {
            const parsed = RecordSchema.safeParse(JSON.parse(raw));
            return parsed.success ? parsed.data : null;
        } catch {
            return null;
        }
    }

    async delete(chatId: string): Promise<void> {
        await rm(join(this.dir, fileName(chatId)), { force: true });
    }
}
