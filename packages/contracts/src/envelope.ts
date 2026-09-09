import { z } from 'zod';

export const ErrorSchema = z.object({
    code: z.string().min(1),
    message: z.string()
});
export type WireError = z.infer<typeof ErrorSchema>;

export const RequestSchema = z.object({
    id: z.string().min(1),
    type: z.string().min(1),
    payload: z.unknown()
});
export type Request = z.infer<typeof RequestSchema>;

export const ReplyOkSchema = z.object({
    id: z.string().min(1),
    ok: z.literal(true),
    result: z.unknown()
});
export type ReplyOk = z.infer<typeof ReplyOkSchema>;

// The id is nullable so the server can still answer a frame it could not parse at all.
export const ReplyErrorSchema = z.object({
    id: z.string().min(1).nullable(),
    ok: z.literal(false),
    error: ErrorSchema
});
export type ReplyError = z.infer<typeof ReplyErrorSchema>;

export const ReplySchema = z.discriminatedUnion('ok', [ReplyOkSchema, ReplyErrorSchema]);
export type Reply = z.infer<typeof ReplySchema>;

export const EventSchema = z.object({
    type: z.literal('event'),
    event: z.string().min(1),
    payload: z.unknown()
});
export type Event = z.infer<typeof EventSchema>;

export const ServerFrameSchema = z.union([ReplySchema, EventSchema]);
export type ServerFrame = z.infer<typeof ServerFrameSchema>;

export type ParseResult<T> = { ok: true; value: T } | { ok: false; message: string };

const toResult = <T>(parsed: z.ZodSafeParseResult<T>): ParseResult<T> => {
    if (parsed.success) {
        return { ok: true, value: parsed.data };
    }
    return { ok: false, message: z.prettifyError(parsed.error) };
};

export const parseRequest = (input: unknown): ParseResult<Request> => toResult(RequestSchema.safeParse(input));

export const parseServerFrame = (input: unknown): ParseResult<ServerFrame> => toResult(ServerFrameSchema.safeParse(input));
