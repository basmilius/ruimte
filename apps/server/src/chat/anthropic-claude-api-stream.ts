import { z } from 'zod';

const MAX_STREAM_BYTES = 16 * 1024 * 1024;

const UsageSchema = z.object({
    input_tokens: z.number().nonnegative().optional(),
    cache_creation_input_tokens: z.number().nonnegative().nullish(),
    cache_read_input_tokens: z.number().nonnegative().nullish(),
    output_tokens: z.number().nonnegative().optional()
});

const EventSchema = z.discriminatedUnion('type', [
    z.object({ type: z.literal('ping') }),
    z.object({ type: z.literal('message_start'), message: z.object({ usage: UsageSchema.optional() }) }),
    z.object({
        type: z.literal('content_block_start'),
        index: z.number().int().min(0).max(63),
        content_block: z.object({
            type: z.string(),
            text: z.string().optional(),
            thinking: z.string().optional(),
            signature: z.string().optional(),
            data: z.string().optional(),
            id: z.string().optional(),
            name: z.string().optional()
        })
    }),
    z.object({
        type: z.literal('content_block_delta'),
        index: z.number().int().min(0).max(63),
        delta: z.object({
            type: z.string(),
            text: z.string().optional(),
            thinking: z.string().optional(),
            signature: z.string().optional(),
            partial_json: z.string().optional()
        })
    }),
    z.object({ type: z.literal('content_block_stop'), index: z.number().int().min(0).max(63) }),
    z.object({
        type: z.literal('message_delta'),
        delta: z.object({ stop_reason: z.string().nullish() }).optional(),
        usage: UsageSchema.optional()
    }),
    z.object({ type: z.literal('message_stop') }),
    z.object({ type: z.literal('error'), error: z.object({ type: z.string().optional() }).optional() })
]);

/* What a request cost in tokens, as Anthropic counts them: the input apart from both cache kinds. */
export interface AnthropicUsage {
    input: number;
    cacheRead: number;
    cacheWrite: number;
    output: number;
}

export interface AnthropicToolUse {
    id: string;
    name: string;
    /* Null when the pieces of the input did not make JSON, which the model hears as an error in the result. */
    input: Record<string, unknown> | null;
}

/* A block of an assistant turn as it is sent back: a thinking block keeps its signature, or the API refuses the next request. */
export type AnthropicBlock =
    | { type: 'thinking'; thinking: string; signature: string }
    | { type: 'redacted_thinking'; data: string }
    | { type: 'text'; text: string }
    | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

export interface AnthropicTurn {
    /* In the order the model wrote them, which is the order they are sent back in. */
    content: AnthropicBlock[];
    text: string;
    thinking: string;
    toolCalls: AnthropicToolUse[];
    stopReason: string;
}

interface OpenBlock {
    type: string;
    text: string;
    thinking: string;
    signature: string;
    data: string;
    id: string;
    name: string;
    json: string;
}

/* A sentence for an error the stream carried, from its type alone, so nothing of what Anthropic wrote reaches a thread. */
function streamError(type: string | undefined): Error {
    if (type === 'overloaded_error') {
        return new Error('Anthropic is overloaded. Try again in a moment.');
    }
    if (type === 'rate_limit_error') {
        return new Error('Anthropic rate limit reached. Wait before trying again.');
    }
    if (type === 'authentication_error' || type === 'permission_error') {
        return new Error('Anthropic rejected the API key.');
    }
    return new Error(`Anthropic reported an error${type === undefined ? '' : ` (${type})`}.`);
}

/*
 * Reads one streamed message: its text and thinking as they come, its tool calls once their input is whole, and
 * the counts of tokens, which arrive at the start and again, cumulative, at the end. Anything else in the
 * stream (a ping, an event this version does not know) is skipped, and a stream that stops before `message_stop` is an
 * error and not a short answer.
 */
export async function readAnthropicStream(
    body: ReadableStream<Uint8Array>,
    onText: (text: string) => void,
    onThinking: (text: string) => void,
    onUsage: (usage: AnthropicUsage) => void
): Promise<AnthropicTurn> {
    const blocks = new Map<number, OpenBlock>();
    const usage: AnthropicUsage = { input: 0, cacheRead: 0, cacheWrite: 0, output: 0 };
    let stopReason: string | null = null;
    let complete = false;
    let buffer = '';
    let bytes = 0;
    const decoder = new TextDecoder();

    // A later count replaces an earlier one field by field, since the ones at the end are cumulative.
    const countUsage = (counts: z.infer<typeof UsageSchema> | undefined): void => {
        if (counts === undefined) {
            return;
        }
        usage.input = counts.input_tokens ?? usage.input;
        usage.cacheRead = counts.cache_read_input_tokens ?? usage.cacheRead;
        usage.cacheWrite = counts.cache_creation_input_tokens ?? usage.cacheWrite;
        usage.output = counts.output_tokens ?? usage.output;
        onUsage({ ...usage });
    };

    const consume = (frame: string): void => {
        const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
        if (data === '') {
            return;
        }
        const parsed = EventSchema.safeParse(JSON.parse(data));
        // An event of a kind this version does not know is not an error: the API adds some.
        if (!parsed.success) {
            return;
        }
        const event = parsed.data;
        if (event.type === 'error') {
            throw streamError(event.error?.type);
        }
        if (event.type === 'message_start') {
            countUsage(event.message.usage);
        } else if (event.type === 'content_block_start') {
            const start = event.content_block;
            blocks.set(event.index, {
                type: start.type,
                text: start.text ?? '',
                thinking: start.thinking ?? '',
                signature: start.signature ?? '',
                data: start.data ?? '',
                id: start.id ?? '',
                name: start.name ?? '',
                json: ''
            });
            if (start.type === 'text' && start.text) {
                onText(start.text);
            }
            if (start.type === 'thinking' && start.thinking) {
                onThinking(start.thinking);
            }
        } else if (event.type === 'content_block_delta') {
            const block = blocks.get(event.index);
            const delta = event.delta;
            if (block === undefined) {
                return;
            }
            if (delta.type === 'text_delta' && delta.text) {
                block.text += delta.text;
                onText(delta.text);
            } else if (delta.type === 'thinking_delta' && delta.thinking) {
                block.thinking += delta.thinking;
                onThinking(delta.thinking);
            } else if (delta.type === 'signature_delta' && delta.signature) {
                block.signature += delta.signature;
            } else if (delta.type === 'input_json_delta' && delta.partial_json) {
                block.json += delta.partial_json;
            }
        } else if (event.type === 'message_delta') {
            stopReason = event.delta?.stop_reason ?? stopReason;
            countUsage(event.usage);
        } else if (event.type === 'message_stop') {
            complete = true;
        }
    };

    for await (const chunk of body) {
        bytes += chunk.byteLength;
        if (bytes > MAX_STREAM_BYTES) {
            throw new Error('Anthropic response exceeded the size limit.');
        }
        // A line ending can fall across two chunks, so the whole buffer is normalized each time.
        buffer = (buffer + decoder.decode(chunk, { stream: true })).replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            consume(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
        }
        if (complete) {
            break;
        }
    }
    if (!complete || stopReason === null) {
        throw new Error('Anthropic connection ended before the response completed.');
    }

    const content: AnthropicBlock[] = [];
    const toolCalls: AnthropicToolUse[] = [];
    let text = '';
    let thinking = '';
    for (const [, block] of [...blocks.entries()].sort(([a], [b]) => a - b)) {
        if (block.type === 'text' && block.text !== '') {
            content.push({ type: 'text', text: block.text });
            text += block.text;
        } else if (block.type === 'thinking') {
            content.push({ type: 'thinking', thinking: block.thinking, signature: block.signature });
            thinking += block.thinking;
        } else if (block.type === 'redacted_thinking') {
            content.push({ type: 'redacted_thinking', data: block.data });
        } else if (block.type === 'tool_use') {
            let input: Record<string, unknown> | null = null;
            try {
                const value: unknown = block.json === '' ? {} : JSON.parse(block.json);
                input = typeof value === 'object' && value !== null && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
            } catch {
                input = null;
            }
            // Sent back, a call whose input is not an object is an empty one, and the result says it was invalid.
            content.push({ type: 'tool_use', id: block.id, name: block.name, input: input ?? {} });
            toolCalls.push({ id: block.id, name: block.name, input });
        }
    }
    return { content, text, thinking, toolCalls, stopReason };
}
