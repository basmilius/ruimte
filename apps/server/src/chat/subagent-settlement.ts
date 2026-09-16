import { open, stat } from 'node:fs/promises';

// The end of a transcript is all the question needs; a final line longer than this reads as undecided.
const TAIL_BYTES = 1024 * 1024;

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null && !Array.isArray(value);

/* How a subagent's own transcript says it ended: when, and the text of its last message. */
export interface SubagentSettlement {
    finishedAt: number | null;
    report: string | null;
}

/*
 * Whether the end of a Claude subagent transcript shows an agent that finished: the last line that
 * is a message is the assistant's, it ended its turn (`stop_reason: end_turn`) and it asked for no
 * tool. Anything else (a tool call still out, a tool result the model has not answered yet, a line
 * still being written, a file cut off in the middle of a line) is not an answer, and null leaves the
 * row as it was. `text` starts on a line boundary.
 */
export const settlementOf = (text: string): SubagentSettlement | null => {
    if (!text.endsWith('\n')) {
        return null;
    }
    const lines = text.split('\n');
    for (let i = lines.length - 1; i >= 0; i--) {
        const line = lines[i]!.trim();
        if (line === '') {
            continue;
        }
        let entry: unknown;
        try {
            entry = JSON.parse(line);
        } catch {
            return null;
        }
        if (!isRecord(entry) || (entry.type !== 'user' && entry.type !== 'assistant')) {
            continue;
        }
        const message = isRecord(entry.message) ? entry.message : {};
        const content = Array.isArray(message.content) ? message.content.filter(isRecord) : [];
        if (entry.type !== 'assistant' || message.stop_reason !== 'end_turn' || content.some((block) => block.type === 'tool_use')) {
            return null;
        }
        const time = typeof entry.timestamp === 'string' ? Date.parse(entry.timestamp) : Number.NaN;
        const report = content
            .map((block) => (block.type === 'text' && typeof block.text === 'string' ? block.text : ''))
            .filter((part) => part.trim() !== '')
            .join('\n');
        return { finishedAt: Number.isFinite(time) ? time : null, report: report === '' ? null : report };
    }
    return null;
};

/*
 * Reads the end of a transcript and asks `settlementOf`. The file has to be the same size and age
 * after the read as before it: a transcript that grew in between belongs to an agent still writing.
 */
export const readSubagentSettlement = async (path: string): Promise<SubagentSettlement | null> => {
    let before: { size: number; mtimeMs: number };
    try {
        before = await stat(path);
    } catch {
        return null;
    }
    const from = Math.max(0, before.size - TAIL_BYTES);
    const handle = await open(path, 'r');
    let text: string;
    try {
        const bytes = Buffer.alloc(before.size - from);
        const { bytesRead } = await handle.read(bytes, 0, bytes.length, from);
        text = bytes.subarray(0, bytesRead).toString('utf8');
    } finally {
        await handle.close();
    }
    const after = await stat(path).catch(() => null);
    if (after === null || after.size !== before.size || after.mtimeMs !== before.mtimeMs) {
        return null;
    }
    if (from > 0) {
        const start = text.indexOf('\n');
        text = start < 0 ? '' : text.slice(start + 1);
    }
    return text === '' ? null : settlementOf(text);
};
