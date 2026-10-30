import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { chmod, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { suggestChatTitle } from '@adecore/agents/chat';
import type { ProviderRegistry as AgentsProviderRegistry } from '@adecore/agents/providers';
import { resolveWithAgent } from '../git/resolve-ai.ts';
import { suggestMessage } from '../git/message.ts';
import { gitIn, initRepo } from '../git/test-repo.ts';
import type { ProviderRegistry } from '../providers/registry.ts';
import { OneShotPlace } from './one-shot-place.ts';

let root: string;
let home: string;
let repo: string;
let marker: string;
let registry: ProviderRegistry;

const ANSWER = '{"title": "A thing", "subject": "fix: a thing", "body": "", "blocks": []}';

/* A CLI that notes where it ran, and whether a hook file sat in that folder, and then answers. */
beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-one-shot-run-')));
    home = join(root, 'home');
    repo = join(root, 'repo');
    marker = join(root, 'marker');
    await mkdir(home);
    const script = join(root, 'fake-cli');
    await writeFile(script, `#!/bin/sh\npwd -P > "${marker}"\necho '${ANSWER}'\n`);
    await chmod(script, 0o755);
    const provider = { name: 'Fake', command: [script], oneShotArgs: (prompt: string) => [prompt] };
    registry = { oneShotProvider: async () => provider } as unknown as ProviderRegistry;
    await initRepo(repo, { 'file.txt': 'one\ntwo\nthree\n' });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function ranIn(): Promise<string> {
    return (await readFile(marker, 'utf8')).trim();
}

async function stage(): Promise<void> {
    await writeFile(join(repo, 'file.txt'), 'one\ntwo\nthree\nfour\n');
    await gitIn(repo, ['add', 'file.txt']);
}

async function conflict(): Promise<void> {
    await gitIn(repo, ['switch', '--quiet', '-c', 'side']);
    await writeFile(join(repo, 'file.txt'), 'one\ntheir two\nthree\n');
    await gitIn(repo, ['commit', '--quiet', '-am', 'side']);
    await gitIn(repo, ['switch', '--quiet', 'main']);
    await writeFile(join(repo, 'file.txt'), 'one\nour two\nthree\n');
    await gitIn(repo, ['commit', '--quiet', '-am', 'main']);
    await gitIn(repo, ['merge', 'side']).catch(() => undefined);
}

const trusted = (): OneShotPlace => new OneShotPlace(home, { inFolder: () => false });
const untrusted = (): OneShotPlace => new OneShotPlace(home, { inFolder: () => true });

describe.skipIf(process.platform === 'win32')('a commit message', () => {
    test("is written in the checkout when the checkout is the person's own", async () => {
        await stage();
        await suggestMessage(repo, registry, { cwdFor: (folder) => trusted().cwdFor(folder) });
        expect(await ranIn()).toBe(repo);
    });

    test('is written outside a checkout that came from another machine', async () => {
        await stage();
        await suggestMessage(repo, registry, { cwdFor: (folder) => untrusted().cwdFor(folder) });
        expect(await ranIn()).toBe(join(home, 'oneshot'));
    });
});

describe.skipIf(process.platform === 'win32')('help with a conflict', () => {
    test("runs in the checkout when the checkout is the person's own", async () => {
        await conflict();
        await resolveWithAgent(repo, 'file.txt', { ours: 'main', theirs: 'side' }, registry, { cwdFor: (folder) => trusted().cwdFor(folder) });
        expect(await ranIn()).toBe(repo);
    });

    test('runs outside a checkout that came from another machine', async () => {
        await conflict();
        await resolveWithAgent(repo, 'file.txt', { ours: 'main', theirs: 'side' }, registry, { cwdFor: (folder) => untrusted().cwdFor(folder) });
        expect(await ranIn()).toBe(join(home, 'oneshot'));
    });
});

describe.skipIf(process.platform === 'win32')('a chat title', () => {
    const name = async (place: OneShotPlace): Promise<string | null> =>
        suggestChatTitle(registry as unknown as AgentsProviderRegistry, 'codex', { prompt: 'hello', answer: 'hi', cwd: await place.cwdFor(repo) });

    test("is asked in the chat's folder when it is the person's own", async () => {
        expect(await name(trusted())).toBe('A thing');
        expect(await ranIn()).toBe(repo);
    });

    test('is asked outside a folder that came from another machine', async () => {
        expect(await name(untrusted())).toBe('A thing');
        expect(await ranIn()).toBe(join(home, 'oneshot'));
    });
});
