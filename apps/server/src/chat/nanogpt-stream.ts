import { z } from 'zod';

const ChunkSchema = z.object({
    error: z.unknown().optional(),
    usage: z
        .object({
            prompt_tokens: z.number().nonnegative().optional(),
            completion_tokens: z.number().nonnegative().optional(),
            prompt_tokens_details: z.object({ cached_tokens: z.number().nonnegative().nullish() }).nullish(),
            completion_tokens_details: z.object({ reasoning_tokens: z.number().nonnegative().nullish() }).nullish()
        })
        .nullish(),
    choices: z
        .array(
            z.object({
                index: z.number().optional(),
                finish_reason: z.string().nullish(),
                delta: z
                    .object({
                        content: z.string().nullish(),
                        reasoning_content: z.string().nullish(),
                        reasoning: z.string().nullish(),
                        tool_calls: z
                            .array(
                                z.object({
                                    index: z.number().int().min(0).max(31),
                                    id: z.string().optional(),
                                    function: z.object({ name: z.string().optional(), arguments: z.string().optional() }).optional()
                                })
                            )
                            .optional()
                    })
                    .optional()
            })
        )
        .optional()
});
export interface NanoToolRequest {
    id: string;
    type: 'function';
    function: { name: string; arguments: string };
}
export interface NanoAnswer {
    role: 'assistant';
    content: string;
    reasoning_content?: string;
    tool_calls?: NanoToolRequest[];
}

/* What one request cost in tokens, as the API counts them: the prompt holds its cached part, the completion its reasoning. */
export interface NanoUsage {
    prompt: number;
    cached: number;
    completion: number;
    reasoning: number;
}

export async function readNanoStream(
    body: ReadableStream<Uint8Array>,
    onText: (text: string) => void,
    onThinking: (text: string) => void,
    onUsage: (usage: NanoUsage) => void
): Promise<NanoAnswer> {
    const answer: NanoAnswer = { role: 'assistant', content: '' };
    const tools = new Map<number, NanoToolRequest>();
    let buffer = '';
    let bytes = 0;
    let complete = false;
    let finish: string | null = null;
    const decoder = new TextDecoder();
    const consume = (frame: string) => {
        const data = frame
            .split('\n')
            .filter((line) => line.startsWith('data:'))
            .map((line) => line.slice(5).trimStart())
            .join('\n');
        if (!data) {
            return;
        }
        if (data === '[DONE]') {
            complete = true;
            return;
        }
        const chunk = ChunkSchema.parse(JSON.parse(data));
        if (chunk.error) {
            throw new Error('NanoGPT reported a streaming error.');
        }
        if (chunk.usage?.prompt_tokens !== undefined) {
            onUsage({
                prompt: chunk.usage.prompt_tokens,
                cached: chunk.usage.prompt_tokens_details?.cached_tokens ?? 0,
                completion: chunk.usage.completion_tokens ?? 0,
                reasoning: chunk.usage.completion_tokens_details?.reasoning_tokens ?? 0
            });
        }
        const choice = chunk.choices?.find((entry) => !entry.index);
        if (choice?.finish_reason) {
            finish = choice.finish_reason;
        }
        const delta = choice?.delta;
        if (delta?.content) {
            answer.content += delta.content;
            onText(delta.content);
        }
        const thinking = delta?.reasoning_content ?? delta?.reasoning;
        if (thinking) {
            answer.reasoning_content = (answer.reasoning_content ?? '') + thinking;
            onThinking(thinking);
        }
        for (const part of delta?.tool_calls ?? []) {
            const call = tools.get(part.index) ?? { id: '', type: 'function', function: { name: '', arguments: '' } };
            if (part.id) {
                call.id = part.id;
            }
            if (part.function?.name) {
                call.function.name += part.function.name;
            }
            if (part.function?.arguments) {
                call.function.arguments += part.function.arguments;
            }
            tools.set(part.index, call);
        }
    };
    for await (const chunk of body) {
        bytes += chunk.byteLength;
        if (bytes > 8 * 1024 * 1024) {
            throw new Error('NanoGPT response exceeded the size limit.');
        }
        buffer += decoder.decode(chunk, { stream: true }).replace(/\r\n/g, '\n');
        // Also handles CRLF split across network chunks.
        buffer = buffer.replace(/\r\n/g, '\n');
        let boundary: number;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            consume(buffer.slice(0, boundary));
            buffer = buffer.slice(boundary + 2);
        }
        if (complete) {
            break;
        }
    }
    if (!complete || !finish) {
        throw new Error('NanoGPT connection ended before the response completed.');
    }
    if (!['stop', 'tool_calls'].includes(finish)) {
        throw new Error(`NanoGPT stopped with ${finish}. Start a new chat if the context is full.`);
    }
    if (tools.size) {
        answer.tool_calls = [...tools.entries()].sort(([a], [b]) => a - b).map(([, call]) => call);
        if (
            finish !== 'tool_calls' ||
            answer.tool_calls.some((call) => !call.id || !call.function.name) ||
            new Set(answer.tool_calls.map((call) => call.id)).size !== tools.size
        ) {
            throw new Error('NanoGPT returned incomplete tool calls.');
        }
    }
    return answer;
}
