import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import type { FlowContent, ProjectContent } from '@ruimte/contracts';
import { FakeWatch } from '../fs/watch-test-helpers.ts';
import { FlowStore } from './flow-store.ts';
import { ProjectStore } from './project-store.ts';

let root: string;
let home: string;
let folder: string;
let fake: FakeWatch;
let projects: ProjectStore;
let flows: FlowStore;
let projectId: string;

/* A trigger and an action, joined, which is the smallest flow that is worth a file. */
const drawn = (): FlowContent => ({
    cards: {
        'card-a': { kind: 'trigger', card: 'files.changed', args: { path: 'README.md' }, x: 0, y: 0 },
        'card-b': { kind: 'action', card: 'person.notify', args: { text: 'it changed' }, x: 240, y: 0 }
    },
    links: [{ from: 'card-a', fromPort: 'done', to: 'card-b' }]
});

const content = (...flowIds: string[]): ProjectContent => ({
    name: 'repo',
    color: '#123456',
    views: [
        { kind: 'canvas', id: 'main', name: 'Canvas', nodes: [], texts: [], edges: [], layouts: [] },
        ...flowIds.map((id) => ({ kind: 'flow' as const, id, name: id }))
    ]
});

const privateFlowsDir = (): string => join(folder, '.ruimte', 'private', 'flows');

const sharedFlowsDir = (): string => join(folder, '.ruimte', 'flows');

const exists = async (path: string): Promise<boolean> => {
    try {
        await stat(path);
        return true;
    } catch {
        return false;
    }
};

beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'ruimte-flows-'));
    home = join(root, 'home');
    folder = join(root, 'repo');
    await mkdir(folder);
    fake = new FakeWatch();
    projects = new ProjectStore(home, fake);
    flows = new FlowStore(projects, fake);
    projects.attachFlows(flows);
    const opened = await projects.openProject({ folder });
    projectId = opened.summary.projectId;
    await projects.save(projectId, 0, content('view-a'));
});

afterEach(async () => {
    flows.closeAll();
    projects.closeAll();
    await rm(root, { recursive: true, force: true });
});

describe('FlowStore', () => {
    test('a flow follows its view into git and back out again', async () => {
        await flows.open(projectId, 'view-a');
        await flows.save(projectId, 'view-a', 0, drawn());
        expect(await exists(join(privateFlowsDir(), 'view-a.json'))).toBe(true);

        await projects.save(projectId, 1, content('view-a'), ['view-a']);
        expect(await exists(join(sharedFlowsDir(), 'view-a.json'))).toBe(true);
        expect(await exists(join(privateFlowsDir(), 'view-a.json'))).toBe(false);
        expect(Object.keys((await flows.open(projectId, 'view-a')).cards)).toEqual(['card-a', 'card-b']);

        await projects.save(projectId, 2, content('view-a'), []);
        expect(await exists(join(privateFlowsDir(), 'view-a.json'))).toBe(true);
        expect(await exists(join(sharedFlowsDir(), 'view-a.json'))).toBe(false);
    });

    test('opening a flow nobody drew gives an empty one and writes nothing', async () => {
        expect(await flows.open(projectId, 'view-a')).toEqual({ version: 1, rev: 0, cards: {}, links: [] });
        expect(await exists(join(privateFlowsDir(), 'view-a.json'))).toBe(false);
    });

    test('a save writes one card per line, so a diff names the card that changed', async () => {
        await flows.open(projectId, 'view-a');
        expect(await flows.save(projectId, 'view-a', 0, drawn())).toBe(1);
        const text = await readFile(join(privateFlowsDir(), 'view-a.json'), 'utf8');
        expect(text.split('\n')[2]).toBe('  "rev": 1,');
        expect(text).toContain('    "card-a": {"kind":"trigger"');
        expect(text).toContain('    {"from":"card-a","fromPort":"done","to":"card-b"}');
    });

    test('a save that names an older rev is a conflict, and nothing is written', async () => {
        await flows.open(projectId, 'view-a');
        await flows.save(projectId, 'view-a', 0, drawn());
        await expect(flows.save(projectId, 'view-a', 0, drawn())).rejects.toThrow('rev 1');
    });

    test('a line to a card that is not there is refused rather than written', async () => {
        await flows.open(projectId, 'view-a');
        const broken: FlowContent = { ...drawn(), links: [{ from: 'card-a', fromPort: 'done', to: 'card-gone' }] };
        await expect(flows.save(projectId, 'view-a', 0, broken)).rejects.toThrow('card-gone');
    });

    test('the runner reads a flow of a project nobody has open', async () => {
        await flows.open(projectId, 'view-a');
        await flows.save(projectId, 'view-a', 0, drawn());
        flows.closeAll();
        projects.release(projectId);
        expect(Object.keys((await flows.read(projectId, 'view-a'))?.cards ?? {})).toEqual(['card-a', 'card-b']);
    });

    test('a file from a newer Ruimte is refused by name and left where it is', async () => {
        await mkdir(privateFlowsDir(), { recursive: true });
        await writeFile(join(privateFlowsDir(), 'view-a.json'), JSON.stringify({ version: 9, rev: 4, cards: {}, links: [] }));
        await expect(flows.open(projectId, 'view-a')).rejects.toThrow('newer Ruimte');
        expect(await exists(join(privateFlowsDir(), 'view-a.json'))).toBe(true);
    });
});
