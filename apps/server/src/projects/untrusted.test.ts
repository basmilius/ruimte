import { beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { AgentLineageStore } from '@adecore/agents/coordination';
import type { ChatProvider } from '@adecore/agents/providers';
import { shippedProviders } from '../providers/table.ts';
import { tempHomes } from '../temp-home-test-helpers.ts';
import { PeerLinks } from './peer-links.ts';
import { UntrustedFolders, untrustedStartProblem } from './untrusted.ts';

const newHome = tempHomes('ruimte-untrusted-');
let home: string;
let lineage: AgentLineageStore;
let links: PeerLinks;
let cwds: Map<string, string>;
let untrusted: UntrustedFolders;

beforeEach(async () => {
    home = await newHome();
    lineage = new AgentLineageStore(home);
    links = new PeerLinks(home);
    await Promise.all([lineage.load(), links.load()]);
    cwds = new Map();
    untrusted = new UntrustedFolders({ lineage, folders: () => links.worktreeFolders(), cwdOf: (nodeId) => cwds.get(nodeId) ?? null });
});

async function put(nodeId: string, openedBy: string, extra: { peer?: { machineId: string }; relation?: 'fork' } = {}): Promise<void> {
    await lineage.put({ projectId: 'p', nodeId, openedBy, depth: 1, agent: true, ...extra });
}

describe('an agent that came from another machine', () => {
    test('the node a machine gave its task is untrusted, and so is an agent it opened', async () => {
        await put('given', 'peer:machine-a:parent', { peer: { machineId: 'machine-a' } });
        await put('child', 'given');
        await put('grandchild', 'child');
        expect(untrusted.fromPeer('given')).toBe(true);
        expect(untrusted.fromPeer('child')).toBe(true);
        expect(untrusted.fromPeer('grandchild')).toBe(true);
    });

    test('an agent of a person stays trusted', async () => {
        await put('own', 'chat-lead');
        await put('own-child', 'own');
        expect(untrusted.fromPeer('own-child')).toBe(false);
        expect(untrusted.fromPeer('unknown')).toBe(false);
    });

    test('a fork of such a chat is untrusted too', async () => {
        await put('given', 'peer:machine-a:parent', { peer: { machineId: 'machine-a' } });
        await put('fork', 'given', { relation: 'fork' });
        expect(untrusted.fromPeer('fork')).toBe(true);
    });

    test('a loop in the records ends', async () => {
        await put('one', 'two');
        await put('two', 'one');
        expect(untrusted.fromPeer('one')).toBe(false);
    });
});

describe('a folder made from work another machine sent', () => {
    test('a node that works in it is untrusted, whoever started it', async () => {
        const worktree = join(home, 'worktrees', 'task');
        await mkdir(join(worktree, 'src'), { recursive: true });
        await links.bind('machine-a', 'Studio', 'p');
        await links.recordTask('machine-a', 'given', { projectId: 'p', cwd: worktree, worktree: true });
        cwds.set('person-chat', join(worktree, 'src'));
        cwds.set('other-chat', join(home, 'elsewhere'));
        expect(untrusted.node('person-chat')).toBe(true);
        expect(untrusted.node('other-chat')).toBe(false);
        expect(untrusted.inFolder(worktree)).toBe(true);
    });

    test('a symlink into it does not hide it', async () => {
        const worktree = join(home, 'worktrees', 'task');
        await mkdir(worktree, { recursive: true });
        await symlink(worktree, join(home, 'shortcut'));
        await links.bind('machine-a', 'Studio', 'p');
        await links.recordTask('machine-a', 'given', { projectId: 'p', cwd: worktree, worktree: true });
        expect(untrusted.inFolder(join(home, 'shortcut'))).toBe(true);
    });

    test('a task in the project folder itself leaves that folder trusted', async () => {
        const folder = join(home, 'repo');
        await mkdir(folder, { recursive: true });
        await links.bind('machine-a', 'Studio', 'p');
        await links.recordTask('machine-a', 'given', { projectId: 'p', cwd: folder, worktree: false });
        expect(untrusted.inFolder(folder)).toBe(false);
    });

    test('it stays untrusted after the link is removed and after a restart', async () => {
        const worktree = join(home, 'worktrees', 'task');
        await mkdir(worktree, { recursive: true });
        await links.bind('machine-a', 'Studio', 'p');
        await links.recordTask('machine-a', 'given', { projectId: 'p', cwd: worktree, worktree: true });
        await links.unbind('machine-a', 'p');
        const reloaded = new PeerLinks(home);
        await reloaded.load();
        expect(reloaded.taskRecordsOf('machine-a')).toEqual([]);
        expect(reloaded.worktreeFolders()).toEqual([worktree]);
    });
});

function provider(kind: string): ChatProvider {
    return shippedProviders().find((candidate) => candidate.kind === kind)!;
}

describe('what may start in an untrusted place', () => {
    test('only a chat of a provider that can leave the configuration out', () => {
        expect(untrustedStartProblem(provider('claude'), false)).toBeNull();
        expect(untrustedStartProblem(provider('codex'), false)).toContain('Codex cannot run there');
        expect(untrustedStartProblem(provider('claude'), true)).toContain('terminal agent');
    });
});
