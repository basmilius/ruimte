import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { GitRepo, GitStatus, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { openCanvasPage, type CanvasPage } from '../../testing/canvas-page';
import { chatInfoOf } from '../../testing/chat-info';
import { until } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';

const FOLDER = '/work/atlas';

const STATUS: GitStatus = {
    repo: true,
    root: FOLDER,
    branch: 'main',
    detached: false,
    upstream: null,
    ahead: 0,
    behind: 0,
    base: null,
    mergeBase: null,
    files: [],
    truncated: false,
    live: true
};

const REPOS: GitRepo[] = [{ path: FOLDER, label: 'atlas', kind: 'root' }];

const CHATS = ['chat-one', 'chat-two', 'chat-three'];

const MAIN: ProjectCanvasView = {
    kind: 'canvas',
    id: 'main',
    name: 'Main',
    nodes: CHATS.map((id, i) => ({ kind: 'chat', id, title: id, x: i * 600, y: 0, w: 480, h: 520 }) as unknown as ProjectNode),
    texts: [],
    edges: [],
    layouts: []
};

let machine: FakeMachine;
let canvas: CanvasPage;
let answerRepos: () => void;
let answerConnections: () => void;

/* Until the machine hears nothing new for a while, counted in turns of the event loop rather than by a clock. */
async function quiet(): Promise<void> {
    let seen = -1;
    for (let round = 0; round < 50 && seen !== machine.sent.length; round++) {
        seen = machine.sent.length;
        for (let i = 0; i < 5; i++) {
            await until(() => true);
        }
    }
}

beforeEach(async () => {
    machine = new FakeMachine();
    const repos: Array<() => void> = [];
    const connections: Array<() => void> = [];
    answerRepos = () => repos.splice(0).forEach((answer) => answer());
    answerConnections = () => connections.splice(0).forEach((answer) => answer());
    machine.answer('chat.attach', ({ chatId }) => ({ info: chatInfoOf(chatId, { cwd: FOLDER }), items: [], seq: 0 }) as never);
    machine.answer('git.watch', () => ({ status: STATUS }));
    machine.answer('git.repos', () => new Promise((resolve) => repos.push(() => resolve({ repos: REPOS, truncated: false }))));
    machine.answer('database.connections', () => new Promise((resolve) => connections.push(() => resolve({ rev: 0, connections: [] }))));
    canvas = await openCanvasPage(machine, [MAIN], CHATS[2]!);
});

afterEach(async () => {
    answerRepos();
    answerConnections();
    await canvas.close();
});

describe('opening a project with three chats', () => {
    test('every view of the project folder rides on the one ask for its repositories while it is out', async () => {
        await until(() => machine.requests('git.watch').length > 0);
        await quiet();
        expect(machine.requests('git.repos')).toEqual([{ folder: FOLDER }]);
    });

    test('the chats that join a watch on their folder while it opens take its status and ask for none', async () => {
        await until(() => machine.requests('git.watch').length > 0);
        await quiet();
        expect(machine.requests('git.watch')).toEqual([{ cwd: FOLDER, status: true }]);
        expect(machine.requests('git.status')).toEqual([]);
    });

    test('the launches of the project are read once', async () => {
        await quiet();
        expect(machine.requests('launches.read')).toEqual([{ projectId: 'project-atlas' }]);
    });

    test('which connections agents may use is asked beside the list, before it is answered', async () => {
        await until(() => machine.requests('database.connections').length > 0);
        await quiet();
        expect(machine.requests('database.agentAccess')).toEqual([{ projectId: 'project-atlas' }]);
        expect(machine.requests('database.passwords')).toEqual([]);
    });
});
