import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { ChatEvent } from '@ruimte/contracts';
import { ChatLog, parseLog } from './chat-log.ts';

const delta = (text: string): ChatEvent => ({ type: 'delta', itemId: 'a1', text });

let dir: string;
let path: string;

beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), 'ruimte-chat-log-'));
    path = join(dir, 'chats', 'chat.log');
});

afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
});

describe('ChatLog', () => {
    test('numbers every event from one and writes a line for each', async () => {
        const log = new ChatLog(path);
        expect([log.append(delta('a'), 10), log.append(delta('b'), 11)]).toEqual([1, 2]);
        log.close();
        expect(parseLog(await readFile(path, 'utf8'))).toEqual([
            { seq: 1, at: 10, event: delta('a') },
            { seq: 2, at: 11, event: delta('b') }
        ]);
    });

    test('a torn last line is left out and what came before it still reads', async () => {
        const log = new ChatLog(path);
        log.append(delta('a'), 10);
        log.close();
        await appendFile(path, '{"seq":2,"at":11,"event":{"type":"del');
        expect(parseLog(await readFile(path, 'utf8')).map((line) => line.seq)).toEqual([1]);
    });

    test('a line appended after a torn tail is read back, and so is every line after it', async () => {
        const first = new ChatLog(path);
        first.append(delta('a'), 10);
        first.close();
        await appendFile(path, '{"seq":2,"at":11,"event":{"type":"del');
        const lines = parseLog(await readFile(path, 'utf8'));
        const log = new ChatLog(path, { seq: 1, resetSeq: 0, lines });
        log.append(delta('b'), 12);
        log.append(delta('c'), 13);
        log.close();
        expect(parseLog(await readFile(path, 'utf8')).map((line) => `${line.seq}:${line.event.type === 'delta' ? line.event.text : ''}`)).toEqual([
            '1:a',
            '2:b',
            '3:c'
        ]);
    });

    test('answers what came after a seq only while it holds all of it', () => {
        const log = new ChatLog(path, { seq: 4, resetSeq: 0, lines: [] });
        log.append(delta('a'), 1);
        log.append({ type: 'info', info: {} as never }, 2);
        log.append(delta('c'), 3);
        expect(log.after(7)).toEqual([]);
        expect(log.after(5)?.map((event) => event.type)).toEqual(['info', 'delta']);
        expect(log.after(4)).toHaveLength(3);
        // Folded into the snapshot before this life of the log began, or never handed out.
        expect(log.after(3)).toBeNull();
        expect(log.after(8)).toBeNull();
        log.close();
    });

    test('a seq from before a reset is never answered from after it', () => {
        const log = new ChatLog(path);
        log.append(delta('a'), 1);
        log.append({ type: 'reset', info: {} as never, items: [] }, 2);
        log.append(delta('c'), 3);
        expect(log.resetSeq).toBe(2);
        expect(log.after(1)).toBeNull();
        expect(log.after(2)).toEqual([delta('c')]);
        log.close();
    });

    test('folding keeps the lines a snapshot does not hold yet and appends after them', async () => {
        const log = new ChatLog(path);
        for (const text of ['a', 'b', 'c']) {
            log.append(delta(text), 1);
        }
        log.compact(2);
        expect(parseLog(await readFile(path, 'utf8')).map((line) => line.seq)).toEqual([3]);
        expect(log.after(1)).toBeNull();
        expect(log.after(2)).toEqual([delta('c')]);
        log.append(delta('d'), 1);
        // An older snapshot landing after this fold changes nothing.
        log.compact(1);
        log.close();
        expect(parseLog(await readFile(path, 'utf8')).map((line) => line.seq)).toEqual([3, 4]);
        expect(log.size).toBe((await readFile(path, 'utf8')).length);

        log.compact(4);
        expect(await Bun.file(path).exists()).toBe(false);
        expect(log.size).toBe(0);
    });

    test('picks up where the files left it', () => {
        const lines = [3, 4].map((seq) => ({ seq, at: 1, event: delta(String(seq)) }));
        const log = new ChatLog(path, { seq: 2, resetSeq: 1, lines });
        expect(log.seq).toBe(4);
        expect(log.after(2)).toHaveLength(2);
        expect(log.append(delta('next'), 1)).toBe(5);
        log.close();
    });
});
