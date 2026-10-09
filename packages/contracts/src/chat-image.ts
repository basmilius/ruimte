import { z } from 'zod';
import { FsCreateResultSchema } from './fs.ts';

export const ChatImageTargetPayloadSchema = z.object({
    chatId: z.string().min(1),
    attachmentId: z.string().min(1),
    path: z.string().min(1).optional()
});
export type ChatImageTargetPayload = z.infer<typeof ChatImageTargetPayloadSchema>;

export const ChatImageTargetResultSchema = z.object({
    folder: z.string(),
    projectName: z.string(),
    name: z.string(),
    exists: z.boolean(),
    revision: z.string().nullable()
});
export type ChatImageTargetResult = z.infer<typeof ChatImageTargetResultSchema>;

export const ChatImageSavePayloadSchema = ChatImageTargetPayloadSchema.extend({
    path: z.string().min(1),
    replace: z.string().min(1).optional()
});
export type ChatImageSavePayload = z.infer<typeof ChatImageSavePayloadSchema>;

export const ChatImageSaveResultSchema = FsCreateResultSchema.extend({ path: z.string() });
export type ChatImageSaveResult = z.infer<typeof ChatImageSaveResultSchema>;
