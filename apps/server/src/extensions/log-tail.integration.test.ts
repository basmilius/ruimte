import { afterAll, expect, test } from 'bun:test';
import { appendFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { logTail } from './log-tail.ts';

const folder = mkdtempSync(join(tmpdir(), 'ruimte-log-tail-'));

afterAll(() => rmSync(folder, { recursive: true, force: true }));

test('answers only what was added since, also for a file that comes later or starts over', () => {
    const path = join(folder, 'server.log');
    const read = logTail(path);

    expect(read()).toBe('');

    writeFileSync(path, 'first\n');
    expect(read()).toBe('first\n');
    expect(read()).toBe('');

    appendFileSync(path, 'second\n');
    expect(read()).toBe('second\n');

    writeFileSync(path, 'new\n');
    expect(read()).toBe('new\n');
});

test('keeps a character whole that a write split over two reads', () => {
    const path = join(folder, 'split.log');
    const read = logTail(path);
    const bytes = Buffer.from('café\n');

    writeFileSync(path, bytes.subarray(0, 4));
    const first = read();

    appendFileSync(path, bytes.subarray(4));

    expect(`${first}${read()}`).toBe('café\n');
});
