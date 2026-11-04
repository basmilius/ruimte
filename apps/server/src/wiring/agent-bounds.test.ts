import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { CommandApprovals } from '../sessions/command-approvals.ts';
import { agentBounds, type AgentBounds } from './agent-bounds.ts';

let root: string;
let project: string;
let approvals: CommandApprovals;
let bounds: AgentBounds;

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-agent-bounds-')));
    project = join(root, 'project');
    await mkdir(join(project, 'src'), { recursive: true });
    approvals = new CommandApprovals(join(root, 'home'));
    await approvals.load();
    bounds = agentBounds({
        commandApprovals: approvals,
        ceilingOf: (nodeId) => (nodeId === 'child' ? 'supervised' : null),
        madeByAgent: (nodeId) => nodeId === 'child',
        folderOf: (nodeId) => (nodeId === 'unplaced' ? null : project),
        worktreePaths: () => Promise.resolve([])
    });
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

describe('the bounds the daemon builds its terminals and chats with', () => {
    test('hold a command until a person approved it for its node', async () => {
        expect(bounds.commands.approved('node', 'bun dev')).toBe(false);

        await bounds.commands.approve('node', 'bun dev');
        expect(bounds.commands.approved('node', 'bun dev')).toBe(true);
        expect(bounds.commands.approved('node', 'rm -rf .')).toBe(false);
        expect(bounds.commands.approved('other', 'bun dev')).toBe(false);
    });

    test('hold every command of a node no project places, and refuse to approve one', async () => {
        expect(bounds.commands.approved('unplaced', 'bun dev')).toBe(false);
        await expect(bounds.commands.approve('unplaced', 'bun dev')).rejects.toThrow('No project this machine knows places unplaced');
    });

    test('cap a node at the ceiling its lineage gives', () => {
        expect(bounds.modeCeiling('child')).toBe('supervised');
        expect(bounds.modeCeiling('node')).toBeNull();
    });

    test('keep a node an agent made inside its project folder', async () => {
        await expect(bounds.checkCwd('child', join(project, 'src'))).resolves.toBeUndefined();
        await expect(bounds.checkCwd('child', root)).rejects.toMatchObject({ code: 'cwd-outside-project' });
    });
});
