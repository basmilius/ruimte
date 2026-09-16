import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { readSubagentSettlement, settlementOf } from './subagent-settlement.ts';

// Lines in the shape Claude Code 2.1.273 writes them into `subagents/agent-<id>.jsonl`.
const assistant = (content: unknown[], stopReason: string | null, timestamp = '2026-09-16T09:12:12.045Z'): string =>
    JSON.stringify({
        isSidechain: true,
        agentId: 'a91114f36f4c6b0ef',
        type: 'assistant',
        timestamp,
        message: { id: 'msg_1', type: 'message', role: 'assistant', content, stop_reason: stopReason }
    });

const toolResult = (timestamp = '2026-09-16T09:12:10.661Z'): string =>
    JSON.stringify({
        isSidechain: true,
        type: 'user',
        timestamp,
        message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_handback', content: 'Delivered.' }] }
    });

const attachment = JSON.stringify({ isSidechain: true, type: 'attachment', timestamp: '2026-09-16T09:12:10.663Z', attachment: { type: 'output_style' } });

const handback = assistant([{ type: 'tool_use', id: 'toolu_handback', name: 'SubagentHandback', input: { message: 'The report' } }], 'tool_use');

const lines = (...entries: string[]): string => `${entries.join('\n')}\n`;

describe('what the end of a subagent transcript says', () => {
    test('a last message that ended the turn is finished, with its time and its text', () => {
        const text = lines(handback, toolResult(), attachment, assistant([{ type: 'text', text: 'Het rapport staat hierboven.' }], 'end_turn'));
        expect(settlementOf(text)).toEqual({ finishedAt: Date.parse('2026-09-16T09:12:12.045Z'), report: 'Het rapport staat hierboven.' });
    });

    test('an agent that ends mid tool call is not finished', () => {
        expect(settlementOf(lines(handback))).toBeNull();
        // The tool answered, but the model has not written its next message yet.
        expect(settlementOf(lines(handback, toolResult(), attachment))).toBeNull();
    });

    test('a thinking block without a stop reason is a message still being written', () => {
        expect(settlementOf(lines(toolResult(), assistant([{ type: 'thinking', thinking: '' }], null)))).toBeNull();
    });

    test('a transcript still growing, its last line half written, is not finished', () => {
        const whole = lines(toolResult(), assistant([{ type: 'text', text: 'Done.' }], 'end_turn'));
        expect(settlementOf(whole.slice(0, -1))).toBeNull();
        expect(settlementOf(whole.slice(0, -20))).toBeNull();
    });

    test('nothing that is a message says nothing', () => {
        expect(settlementOf(lines(attachment))).toBeNull();
        expect(settlementOf('')).toBeNull();
    });
});

describe('reading the end of a transcript', () => {
    let dir: string;

    beforeEach(async () => {
        dir = await mkdtemp(join(tmpdir(), 'ruimte-settlement-'));
    });

    afterEach(async () => {
        await rm(dir, { recursive: true, force: true });
    });

    test('reads a finished file, and answers null for one that is gone', async () => {
        const path = join(dir, 'agent-a1.jsonl');
        await writeFile(path, lines(toolResult(), assistant([{ type: 'text', text: 'Done.' }], 'end_turn')));
        expect(await readSubagentSettlement(path)).toMatchObject({ report: 'Done.' });
        expect(await readSubagentSettlement(join(dir, 'agent-missing.jsonl'))).toBeNull();
    });

    test('a file larger than the tail it reads starts at the next whole line', async () => {
        const path = join(dir, 'agent-a2.jsonl');
        const filler = assistant([{ type: 'text', text: 'x'.repeat(700 * 1024) }], 'tool_use');
        await writeFile(path, lines(filler, filler, assistant([{ type: 'text', text: 'Done.' }], 'end_turn')));
        expect(await readSubagentSettlement(path)).toMatchObject({ report: 'Done.' });
    });
});
