import { afterEach, beforeEach, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { MachineHome } from './machine-home.ts';

let root: string;
let home: string;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-machine-home-')));
    home = join(root, 'home');
    await mkdir(join(home, 'chats', 'chat-1.visuals'), { recursive: true });
    await mkdir(join(home, 'computer-use', 'screenshots'), { recursive: true });
    await mkdir(join(home, 'worktrees'), { recursive: true });
    await writeFile(join(home, 'local.key'), 'secret');
    await writeFile(join(home, 'chats', 'chat-1.jsonl'), 'thread');
    await writeFile(join(home, 'computer-use', 'state.json'), '{}');
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

test('stateWithin names the machine state under a home in the folder and keeps the open folders', async () => {
    expect(await new MachineHome(home).stateWithin(root)).toEqual(['home/chats/chat-1.jsonl', 'home/computer-use/state.json', 'home/local.key']);
});

test('stateWithin names nothing for a folder the home is not in', async () => {
    expect(await new MachineHome(home).stateWithin(join(home, 'worktrees'))).toEqual([]);
});

test('stateWithin leaves the whole home out once its list would not fit on a command line', async () => {
    await Promise.all(Array.from({ length: 600 }, (_, i) => writeFile(join(home, 'chats', `chat-with-a-long-name-${i}.jsonl`), '')));

    expect(await new MachineHome(home).stateWithin(root)).toEqual(['home']);
});
