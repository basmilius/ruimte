import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { appendFile, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CodexTitleReader } from './codex-title.ts';

const line = (id: string, name: unknown): string => `${JSON.stringify({ id, thread_name: name, updated_at: '2026-09-14T12:00:00.000000Z' })}\n`;

let root: string;
let index: string;

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-codex-title-'));
    index = join(root, 'session_index.jsonl');
    await writeFile(index, [line('t-1', 'First name'), line('t-2', 'Other thread'), line('t-1', '  Fix the\nbuild  ')].join(''));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('CodexTitleReader', () => {
    test('takes the last name of a thread, cleaned to one line', async () => {
        const reader = new CodexTitleReader(index);
        expect(await reader.forThread('t-1')).toBe('Fix the build');
        expect(await reader.forThread('t-2')).toBe('Other thread');
        expect(await reader.forThread('t-3')).toBeNull();
    });

    test('an index that is not there, or a line that is not a name, answers null', async () => {
        expect(await new CodexTitleReader(join(root, 'missing.jsonl')).forThread('t-1')).toBeNull();
        expect(await new CodexTitleReader('').forThread('t-1')).toBeNull();
        await writeFile(index, ['not json "thread_name"\n', line('t-1', 42), line('t-1', '   ')].join(''));
        expect(await new CodexTitleReader(index).forThread('t-1')).toBeNull();
    });

    test('reads on from where it stopped, and leaves a half-written line for later', async () => {
        const reader = new CodexTitleReader(index, 16);
        expect(await reader.forThread('t-3')).toBeNull();
        const later = line('t-3', 'Late name');
        await appendFile(index, later.slice(0, 25));
        expect(await reader.forThread('t-3')).toBeNull();
        await appendFile(index, later.slice(25));
        expect(await reader.forThread('t-3')).toBe('Late name');
        expect(await reader.forThread('t-1')).toBe('Fix the build');
    });

    test('a replaced file is read again from the start', async () => {
        const reader = new CodexTitleReader(index);
        await reader.forThread('t-1');
        await writeFile(index, line('t-9', 'New'));
        expect(await reader.forThread('t-1')).toBeNull();
        expect(await reader.forThread('t-9')).toBe('New');
    });
});
