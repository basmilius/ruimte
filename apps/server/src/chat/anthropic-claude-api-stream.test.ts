import { describe, expect, test } from 'bun:test';
import { readAnthropicStream, type AnthropicUsage } from './anthropic-claude-api-stream.ts';

/* A body that arrives in the pieces given, so a frame or a line ending can fall across two of them. */
function body(...pieces: string[]): ReadableStream<Uint8Array> {
    const encoder = new TextEncoder();
    return new ReadableStream({
        start(controller) {
            for (const piece of pieces) {
                controller.enqueue(encoder.encode(piece));
            }
            controller.close();
        }
    });
}

function frame(event: unknown): string {
    const type = (event as { type: string }).type;
    return `event: ${type}\ndata: ${JSON.stringify(event)}\n\n`;
}

const start = (usage: object = { input_tokens: 25, output_tokens: 1 }) => frame({ type: 'message_start', message: { usage } });
const block = (index: number, content_block: object) => frame({ type: 'content_block_start', index, content_block });
const delta = (index: number, d: object) => frame({ type: 'content_block_delta', index, delta: d });
const stop = (index: number) => frame({ type: 'content_block_stop', index });
const end = (stop_reason: string, usage: object = { output_tokens: 15 }) =>
    frame({ type: 'message_delta', delta: { stop_reason }, usage }) + frame({ type: 'message_stop' });

async function read(stream: ReadableStream<Uint8Array>) {
    const text: string[] = [];
    const thinking: string[] = [];
    const usage: AnthropicUsage[] = [];
    const turn = await readAnthropicStream(
        stream,
        (piece) => text.push(piece),
        (piece) => thinking.push(piece),
        (counts) => usage.push(counts)
    );
    return { turn, text, thinking, usage };
}

describe('readAnthropicStream', () => {
    test('streams text as it comes and keeps the whole message, with a ping and an unknown event skipped', async () => {
        const { turn, text, usage } = await read(
            body(
                start(),
                'event: ping\ndata: {"type": "ping"}\n\n',
                frame({ type: 'something_new', value: 1 }),
                block(0, { type: 'text', text: '' }),
                delta(0, { type: 'text_delta', text: 'Hello ' }),
                delta(0, { type: 'text_delta', text: 'there.' }),
                stop(0),
                end('end_turn')
            )
        );
        expect(text).toEqual(['Hello ', 'there.']);
        expect(turn).toEqual({ content: [{ type: 'text', text: 'Hello there.' }], text: 'Hello there.', thinking: '', toolCalls: [], stopReason: 'end_turn' });
        // The counts of the start, then the cumulative ones of the end, a later one replacing an earlier one field by field.
        expect(usage).toEqual([
            { input: 25, cacheRead: 0, cacheWrite: 0, output: 1 },
            { input: 25, cacheRead: 0, cacheWrite: 0, output: 15 }
        ]);
    });

    test('counts the cache reads and writes of a request apart from its input', async () => {
        const { usage } = await read(
            body(
                start({ input_tokens: 20, cache_creation_input_tokens: 400, cache_read_input_tokens: 9000, output_tokens: 3 }),
                block(0, { type: 'text', text: 'Hi' }),
                stop(0),
                end('end_turn', { output_tokens: 40 })
            )
        );
        expect(usage.at(-1)).toEqual({ input: 20, cacheRead: 9000, cacheWrite: 400, output: 40 });
    });

    test('keeps a thinking block with its signature in front of the tool call it came with, and parses the input once whole', async () => {
        const { turn, thinking } = await read(
            body(
                start(),
                block(0, { type: 'thinking', thinking: '', signature: '' }),
                delta(0, { type: 'thinking_delta', thinking: 'Look at ' }),
                delta(0, { type: 'thinking_delta', thinking: 'the files.' }),
                delta(0, { type: 'signature_delta', signature: 'EqQBCgIY' }),
                stop(0),
                block(1, { type: 'text', text: 'Let me look.' }),
                stop(1),
                block(2, { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} }),
                delta(2, { type: 'input_json_delta', partial_json: '{"path":' }),
                delta(2, { type: 'input_json_delta', partial_json: '"a.txt","offset":0}' }),
                stop(2),
                end('tool_use')
            )
        );
        expect(thinking).toEqual(['Look at ', 'the files.']);
        expect(turn.content).toEqual([
            { type: 'thinking', thinking: 'Look at the files.', signature: 'EqQBCgIY' },
            { type: 'text', text: 'Let me look.' },
            { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: { path: 'a.txt', offset: 0 } }
        ]);
        expect(turn.toolCalls).toEqual([{ id: 'toolu_1', name: 'read_file', input: { path: 'a.txt', offset: 0 } }]);
        expect(turn.stopReason).toBe('tool_use');
    });

    test('puts a message together across chunks and CRLF line endings', async () => {
        const whole = (start() + block(0, { type: 'text', text: '' }) + delta(0, { type: 'text_delta', text: 'Fine.' }) + stop(0) + end('end_turn')).replace(
            /\n/g,
            '\r\n'
        );
        const split = whole.indexOf('\r\n\r\n') + 1;
        const { turn } = await read(body(whole.slice(0, split), whole.slice(split, split + 40), whole.slice(split + 40)));
        expect(turn.text).toBe('Fine.');
    });

    test('a tool call whose input does not make JSON has no input, and is sent back as an empty one', async () => {
        const { turn } = await read(
            body(
                start(),
                block(0, { type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} }),
                delta(0, { type: 'input_json_delta', partial_json: '{"path":' }),
                stop(0),
                end('tool_use')
            )
        );
        expect(turn.toolCalls).toEqual([{ id: 'toolu_1', name: 'read_file', input: null }]);
        expect(turn.content).toEqual([{ type: 'tool_use', id: 'toolu_1', name: 'read_file', input: {} }]);
    });

    test('a call with no input at all is an empty one', async () => {
        const { turn } = await read(body(start(), block(0, { type: 'tool_use', id: 'toolu_1', name: 'list_files', input: {} }), stop(0), end('tool_use')));
        expect(turn.toolCalls[0]!.input).toEqual({});
    });

    test('a redacted thinking block is kept as it is, since the next request needs it', async () => {
        const { turn } = await read(
            body(start(), block(0, { type: 'redacted_thinking', data: 'abc' }), stop(0), block(1, { type: 'text', text: 'Done.' }), stop(1), end('end_turn'))
        );
        expect(turn.content[0]).toEqual({ type: 'redacted_thinking', data: 'abc' });
    });

    test('says why a message ran out of tokens, and that is not an error', async () => {
        const { turn } = await read(body(start(), block(0, { type: 'text', text: 'Long answer' }), stop(0), end('max_tokens')));
        expect(turn.stopReason).toBe('max_tokens');
    });

    test('an error in the stream is a sentence of its own and never what came with it', async () => {
        await expect(read(body(start(), frame({ type: 'error', error: { type: 'overloaded_error', message: 'key sk-ant-secret' } })))).rejects.toThrow(
            'Anthropic is overloaded.'
        );
        await expect(read(body(frame({ type: 'error', error: { type: 'invalid_request_error', message: 'sk-ant-secret' } })))).rejects.toThrow(
            'Anthropic reported an error (invalid_request_error).'
        );
    });

    test('a connection that ends early is an error and not a short answer', async () => {
        await expect(read(body(start(), block(0, { type: 'text', text: 'Half' })))).rejects.toThrow(
            'Anthropic connection ended before the response completed.'
        );
    });
});
