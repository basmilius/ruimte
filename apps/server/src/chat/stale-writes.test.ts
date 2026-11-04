import { expect, test } from 'bun:test';
import { mkdir, readdir, utimes, writeFile } from 'node:fs/promises';
import { basename, join } from 'node:path';
import { tempNameFor } from '@adecore/utils/fs';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { sweepStaleChatWrites } from './stale-writes.ts';

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW = 1_800_000_000_000;

const newHome = tempHomes('ruimte-stale-writes-');

test('takes a temporary write older than a day and keeps a recent one, the records and other files', async () => {
    const home = await newHome();
    const folder = join(home, 'chats');
    await mkdir(folder, { recursive: true });

    const written = async (name: string, ageMs: number): Promise<void> => {
        const path = join(folder, name);
        await writeFile(path, '{}');
        const at = new Date(NOW - ageMs);
        await utimes(path, at, at);
    };

    const current = basename(tempNameFor(join(folder, 'chat-c.json')));

    await written('chat-a.json.9173-2.tmp', DAY_MS + 1_000);
    await written(current, DAY_MS + 1_000);
    await written('chat-b.json.42569-13.tmp', DAY_MS - 1_000);
    await written('chat-a.json', 2 * DAY_MS);
    await written('notes.tmp', 2 * DAY_MS);

    expect(await sweepStaleChatWrites(home, NOW)).toEqual({ files: 2, bytes: 4 });
    expect((await readdir(folder)).sort()).toEqual(['chat-a.json', 'chat-b.json.42569-13.tmp', 'notes.tmp']);
});
