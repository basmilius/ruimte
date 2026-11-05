import { join } from 'node:path';
import { RecordDirectory } from '@adecore/agents';
import { z } from 'zod';

const MoveIntentSchema = z.object({
    chatId: z.string().min(1),
    // The project the chat is moving into.
    to: z.string().min(1),
    folder: z.string().min(1)
});

type MoveIntent = z.infer<typeof MoveIntentSchema>;

/*
 * The chat moves that are under way, under `$RUIMTE_HOME` so a stop in the middle leaves a trace. The
 * placements alone cannot tell a move that wrote nothing yet from one that only moved the conversation,
 * or one that wrote both projects and stopped before the chat's record took the new folder.
 */
export class MoveJournal {
    private readonly records: RecordDirectory<MoveIntent>;

    constructor(home: string) {
        this.records = new RecordDirectory({ dir: join(home, 'chat-moves'), schema: MoveIntentSchema, idOf: (intent) => intent.chatId });
    }

    /* Reads what an earlier run of the daemon wrote down. Call before anything can ask. */
    load(): Promise<void> {
        return this.records.load();
    }

    async begin(intent: MoveIntent): Promise<void> {
        await this.records.write(intent);
    }

    end(chatId: string): Promise<void> {
        return this.records.remove(chatId);
    }

    pending(): MoveIntent[] {
        return this.records.all();
    }
}
