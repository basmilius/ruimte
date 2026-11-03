import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ArtifactStore } from '../artifacts/artifact-store.ts';
import { Artifacts } from '../artifacts/artifacts.ts';
import { MemoryArtifactFs } from '../artifacts/memory-artifact-fs.ts';
import { AgentFiles } from '../mcp/files.ts';
import type { ToolCall } from './tool.ts';
import { toolAnswer, toolCall } from './tool-test-helpers.ts';
import type { CanvasHost } from './host.ts';

let artifacts: Artifacts;
let host: CanvasHost;
let folder: string;

beforeEach(async () => {
    let next = 0;
    folder = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-artifact-tools-')));
    const store = new ArtifactStore({ root: '/home/artifacts', fs: new MemoryArtifactFs(), now: () => 0, newId: () => `id${String(++next).padStart(8, '0')}` });
    await store.load();
    const projectOf = (id: string): string | null => (id === 'chat-other' ? 'p2' : id.startsWith('chat-') ? 'p1' : null);
    artifacts = new Artifacts({
        store,
        home: '/home',
        machineId: 'machine-1',
        projects: {
            known: async () => [
                { projectId: 'p1', name: 'One', folder: '/work/one' },
                { projectId: 'p2', name: 'Two', folder: '/work/two' }
            ],
            projectOf
        },
        chats: { findAttachment: async () => null, hasStored: async () => true },
        machineHome: { refuse: async () => undefined },
        provenanceOf: async (caller) => ({ maker: 'agent', machineId: 'machine-1', chatId: caller, nodeId: caller })
    });
    host = {
        projects: { locate: (id: string) => (projectOf(id) === null ? null : { projectId: projectOf(id)!, folder: '/work', canvasId: 'main' }) },
        artifacts
    } as unknown as CanvasHost;
});

afterEach(async () => {
    await rm(folder, { recursive: true, force: true });
});

/* A call whose files come from the test's folder and whose uploads go to the artifacts of this machine. */
function callOf(caller: string): ToolCall {
    return { ...toolCall(caller, host), uploads: artifacts, files: async () => new AgentFiles(folder, [folder]) };
}

async function answer(tool: string, input: Record<string, unknown>, caller = 'chat-1'): Promise<string[]> {
    return (await toolAnswer(tool, input, callOf(caller))).lines;
}

describe('artifact tools', () => {
    test('publish keeps the files it read, and list and read show them in the same project only', async () => {
        await writeFile(join(folder, 'weekly.md'), '# Weekly\nAll green');
        const published = await answer('artifact_publish', { paths: ['weekly.md'], key: 'weekly', request_id: 'up-1' });
        expect(published[0]).toMatch(/^artifact\tart-\w+\tver-\w+\t1\treport\tweekly\t1\t18$/);
        const artifactId = published[0]!.split('\t')[1]!;

        expect(await answer('artifact_list', {})).toEqual([
            expect.stringMatching(new RegExp(`^artifact\t${artifactId}\tver-\\w+\t1\treport\tweekly\tweekly\t1970-01-01T00:00:00.000Z$`))
        ]);
        expect((await answer('artifact_read', { artifact_id: artifactId })).slice(1)).toEqual([
            'file\t0\tweekly.md\ttext/markdown\t18',
            '',
            '# Weekly',
            'All green'
        ]);

        expect(await answer('artifact_list', {}, 'chat-other')).toEqual(["note\tThis project's Output is empty"]);
        expect((await answer('artifact_read', { artifact_id: artifactId }, 'chat-other'))[0]).toBe('refused\tnot-found\tNo such artifact in this project');
    });

    test('a retry with the same request id says it saved nothing new', async () => {
        await writeFile(join(folder, 'a.txt'), 'one');
        const input = { paths: ['a.txt'], request_id: 'up-1' };
        const first = await answer('artifact_publish', input);
        const again = await answer('artifact_publish', input);
        expect(again[0]).toBe(first[0]);
        expect(again[1]).toStartWith('note\tAn earlier call with this request id saved this version');
    });

    test('a publish without paths, with a reserved or malformed key or an unknown kind, is refused', async () => {
        await writeFile(join(folder, 'a.txt'), 'one');
        expect((await answer('artifact_publish', {}))[0]).toBe('refused\tbad-arguments\tartifact_publish needs paths, one per file');
        expect((await answer('artifact_publish', { paths: [] }))[0]).toBe('refused\tbad-arguments\tartifact_publish needs paths, one per file');
        expect((await answer('artifact_publish', { paths: ['a.txt'], key: 'Weekly' }))[0]).toStartWith('refused\t');
        expect((await answer('artifact_publish', { paths: ['a.txt'], kind: 'video' }))[0]).toStartWith('refused\tbad-arguments\tkind is one of');
    });

    test('a machine that keeps no Output refuses a publish', async () => {
        const { uploads: _uploads, ...call } = callOf('chat-1');
        expect((await toolAnswer('artifact_publish', { paths: ['a.txt'] }, call)).lines[0]).toBe('refused\tunavailable\tThis machine keeps no Output');
    });
});
