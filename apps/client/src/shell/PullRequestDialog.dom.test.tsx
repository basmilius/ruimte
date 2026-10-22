import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { GitPullRequest, ProjectCanvasView } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

const PR: GitPullRequest = {
    repo: 'o/r',
    number: 12,
    url: 'https://github.com/o/r/pull/12',
    title: 'Add things',
    state: 'OPEN',
    isDraft: false,
    headSha: 'abc1234def',
    headBranch: 'feature',
    baseBranch: 'main',
    mergeable: 'MERGEABLE',
    mergeState: 'CLEAN',
    reviewDecision: null,
    checks: [],
    checkState: 'none',
    threads: []
};

const SPLIT = { code: { added: 1200, deleted: 2 }, tests: { added: 29, deleted: 0 }, mocks: { added: 0, deleted: 0 }, generated: { added: 5, deleted: 5 } };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let answer: GitPullRequest;

function header(): string {
    return document.querySelector('[role="dialog"] header')?.textContent ?? '';
}

async function open(): Promise<void> {
    await act(async () => useUi.getState().setPullRequestDialog({ cwd: '/work/atlas' }));
    await until(() => header().includes('Add things'));
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('git.pr', () => ({ pr: answer }));
    machine.answer('git.prSplit', () => ({ split: SPLIT }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setPullRequestDialog(null));
    await page.unmount();
    workspace.close();
});

describe('the pull request dialog', () => {
    test('says how large the pull request is beside its state', async () => {
        answer = {
            ...PR,
            added: 1234,
            deleted: 7,
            changedFiles: 3
        };
        await open();
        expect(header()).toContain('Open');
        expect(header()).toContain('+1,234');
        expect(header()).toContain('-7');
    });

    test('asks for the split once the pull request is on screen, at the head it was answered at', async () => {
        answer = { ...PR, added: 1234, deleted: 7, changedFiles: 3 };
        await open();
        await until(() => machine.requests('git.prSplit').length > 0);
        expect(machine.requests('git.prSplit')).toEqual([{ cwd: '/work/atlas', number: 12, headSha: 'abc1234def' }]);
    });

    test('a machine from before the split request is not asked for one', async () => {
        machine.answersOnly(['git.pr']);
        answer = { ...PR, added: 1234, deleted: 7, changedFiles: 3 };
        await open();
        expect(header()).toContain('+1,234');
        expect(machine.requests('git.prSplit')).toEqual([]);
    });

    test('a machine from before the totals shows no size', async () => {
        answer = PR;
        await open();
        expect(header()).toContain('Open');
        expect(header()).not.toContain('+');
    });
});
