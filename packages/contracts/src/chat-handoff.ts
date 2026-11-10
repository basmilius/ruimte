import { z } from 'zod';

/*
 * The text a chat on another machine starts from: the last turns of this chat up to one turn, and where
 * the new chat works. The new chat is made by the client; this machine only writes what it reads first.
 */
export const ChatHandoffPayloadSchema = z.object({
    chatId: z.string().min(1),
    turnId: z.string().min(1),
    remote: z.object({
        // What this machine is called where the new chat runs.
        machine: z.string().min(1).max(120),
        // The checkout there the new chat works in.
        cwd: z.string().min(1)
    })
});
export type ChatHandoffPayload = z.infer<typeof ChatHandoffPayloadSchema>;

export const ChatHandoffResultSchema = z.object({
    text: z.string(),
    // How many turns the text carries, and whether that is the whole conversation up to the turn.
    turns: z.number().int().nonnegative(),
    all: z.boolean()
});
export type ChatHandoffResult = z.infer<typeof ChatHandoffResultSchema>;

export const CHAT_HANDOFF_REQUEST_SCHEMAS = {
    // Errors: `move-refused`, `files-conflict` and `move-failed`; each leaves the chat where it was.
    'chat.handoff': { payload: ChatHandoffPayloadSchema, result: ChatHandoffResultSchema }
} as const;
