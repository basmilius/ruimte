import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { AgentEvent } from '@ruimte/agents/events';
import type { ServerFrame } from '@ruimte/contracts';
import { Dispatcher } from '../dispatcher.ts';
import { MachineHome } from '../fs/machine-home.ts';
import { ProvenanceService } from '../provenance/provenance-service.ts';
import { registerProvenanceHandlers } from './provenance.ts';

let root: string;
let home: string;
let project: string;
let dispatcher: Dispatcher;
let service: ProvenanceService;

/* A turn of a chat that wrote `score.ts` with one Write, in a folder without git so no checkpoint is in the way. */
async function recordWrite(path: string, text: string): Promise<void> {
    await writeFile(path, text);
    service.consume({
        event: 'chat.event',
        payload: {
            chatId: 'chat-a',
            event: {
                type: 'item',
                item: {
                    id: 'tool-1',
                    createdAt: 1,
                    turnId: 'turn-1',
                    kind: 'tool',
                    toolUseId: 'tool-1',
                    name: 'Write',
                    input: { file_path: path, content: text },
                    output: null,
                    state: 'done',
                    parentToolUseId: null
                }
            }
        }
    } as AgentEvent);
    await service.idle();
}

beforeEach(async () => {
    root = await realpath(await mkdtemp(join(tmpdir(), 'ruimte-provenance-handlers-')));
    home = join(root, 'ruimte-home');
    project = join(root, 'project');
    await mkdir(home, { recursive: true });
    await mkdir(project);
    service = new ProvenanceService({
        home,
        locate: () => ({ projectId: 'p1', folder: project }),
        folderOf: (projectId) => (projectId === 'p1' ? project : null),
        holders: () => [],
        chat: () => ({ provider: 'claude', cwd: project, checkpointOf: () => undefined, turnNumberOf: () => 4, promptOf: () => 'Add rankCandidates' })
    });
    dispatcher = new Dispatcher();
    registerProvenanceHandlers(dispatcher, service, new MachineHome(home));
});

afterEach(async () => {
    await rm(root, { recursive: true, force: true });
});

async function request(type: string, payload: unknown): Promise<ServerFrame> {
    const frames: ServerFrame[] = [];
    await dispatcher.handle({ id: 'client', send: (frame) => frames.push(frame) }, JSON.stringify({ id: 'request', type, payload }));
    return frames[0]!;
}

describe('provenance.read', () => {
    test('answers the runs of a file with the version they are mapped onto', async () => {
        const path = join(project, 'score.ts');
        await recordWrite(path, 'one\ntwo\nthree\n');

        const reply = await request('provenance.read', { projectId: 'p1', path });
        expect(reply).toMatchObject({ ok: true, result: { lines: 3 } });
        const { runs } = (reply as { result: { runs: Array<Record<string, unknown>> } }).result;
        expect(runs).toHaveLength(1);
        expect(runs[0]).toMatchObject({ chatId: 'chat-a', turnId: 'turn-1', turn: 4, provider: 'claude', start: 1, end: 3, review: 'pending', via: 'tool' });
    });

    test('a file nobody wrote has no runs', async () => {
        const path = join(project, 'plain.ts');
        await writeFile(path, 'a\n');
        expect(await request('provenance.read', { projectId: 'p1', path })).toMatchObject({ ok: true, result: { lines: 1, runs: [] } });
    });

    test('refuses a path outside the project and a project the machine does not hold', async () => {
        const outside = join(root, 'outside.ts');
        await writeFile(outside, 'a\n');
        expect(await request('provenance.read', { projectId: 'p1', path: outside })).toMatchObject({ ok: false, error: { code: 'forbidden' } });
        expect(await request('provenance.read', { projectId: 'other', path: join(project, 'score.ts') })).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
    });

    test('refuses what belongs to the state of the machine, even from a project that holds the home', async () => {
        service = new ProvenanceService({ home, locate: () => null, folderOf: () => root, holders: () => [], chat: () => null });
        dispatcher = new Dispatcher();
        registerProvenanceHandlers(dispatcher, service, new MachineHome(home));
        await writeFile(join(home, 'local.key'), 'secret');
        expect(await request('provenance.read', { projectId: 'p1', path: join(home, 'local.key') })).toMatchObject({
            ok: false,
            error: { code: 'machine-state' }
        });
    });

    test('a payload that is not a project and a path is a bad request', async () => {
        expect(await request('provenance.read', { projectId: '', path: '/a' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
        expect(await request('provenance.read', { path: '/a' })).toMatchObject({ ok: false, error: { code: 'bad-request' } });
    });
});

describe('provenance.review', () => {
    test('sets the state of the runs, counts what changed and shows in the next read', async () => {
        const path = join(project, 'score.ts');
        await recordWrite(path, 'one\ntwo\n');
        const read = (await request('provenance.read', { projectId: 'p1', path })) as { result: { runs: Array<{ id: string }> } };
        const runId = read.result.runs[0]!.id;

        expect(await request('provenance.review', { projectId: 'p1', path, runIds: [runId], state: 'kept' })).toMatchObject({
            ok: true,
            result: { updated: 1 }
        });
        expect(await request('provenance.review', { projectId: 'p1', path, runIds: [runId], state: 'kept' })).toMatchObject({
            ok: true,
            result: { updated: 0 }
        });
        const after = (await request('provenance.read', { projectId: 'p1', path })) as { result: { runs: Array<{ review: string }> } };
        expect(after.result.runs.map((run) => run.review)).toEqual(['kept']);
    });

    test('a run that does not exist changes nothing', async () => {
        const path = join(project, 'score.ts');
        await recordWrite(path, 'one\n');
        expect(await request('provenance.review', { projectId: 'p1', path, runIds: ['nope'], state: 'undone' })).toMatchObject({
            ok: true,
            result: { updated: 0 }
        });
    });

    test('refuses a path outside the project and a state that is not one', async () => {
        const outside = join(root, 'outside.ts');
        expect(await request('provenance.review', { projectId: 'p1', path: outside, runIds: ['r1'], state: 'kept' })).toMatchObject({
            ok: false,
            error: { code: 'forbidden' }
        });
        expect(await request('provenance.review', { projectId: 'p1', path: join(project, 'score.ts'), runIds: ['r1'], state: 'pending-ish' })).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
        expect(await request('provenance.review', { projectId: 'p1', path: join(project, 'score.ts'), runIds: [], state: 'kept' })).toMatchObject({
            ok: false,
            error: { code: 'bad-request' }
        });
    });
});
