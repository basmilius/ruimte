import { afterEach, beforeEach, expect, test } from 'bun:test';
import type { GitCompareResult } from '@ruimte/contracts';
import { act } from 'react';
import { useFiles } from '@/state/files';
import { useUi } from '@/state/ui';
import { clickOn, mount, openSubmenu, until, type Mounted } from '../../../testing/dom';
import { buttonWithText, menuItem } from '../../../testing/dom-helpers';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { closeBranchCompare, openComparison, openSnapshot, showBranchCompare } from './branch-compare';

const CWD = '/work/atlas';
const LEFT = 'a'.repeat(40);
const RIGHT = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const MOVED = 'd'.repeat(40);
const PATCH = 'diff --git a/cart.ts b/cart.ts\n--- a/cart.ts\n+++ b/cart.ts\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n';
const CANVAS = { kind: 'canvas' as const, id: 'main', name: 'Main', nodes: [], edges: [], texts: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function comparison(overrides: Partial<GitCompareResult> = {}): GitCompareResult {
    return {
        from: 'refs/heads/left',
        to: 'refs/heads/right',
        fromCommit: LEFT,
        toCommit: RIGHT,
        baseCommit: BASE,
        mode: 'merge-base',
        diff: {
            path: '',
            diff: '',
            added: 1,
            deleted: 1,
            binary: false,
            files: [{ path: 'cart.ts', diff: PATCH, added: 1, deleted: 1, binary: false, kind: 'update' }]
        },
        left: { commits: [{ hash: LEFT, shortHash: 'aaaaaaa', subject: 'Only on left', author: 'Bas', at: 0, refs: [] }], next: 1 },
        right: { commits: [], next: null },
        ...overrides
    };
}

/* Anything that would change the checkout or a file: a comparison must send none of it. */
function writes(): unknown[] {
    return machine.sent.filter(({ type }) => type === 'git.action' || type === 'fs.write' || type === 'fs.rename' || type === 'fs.delete');
}

function option(text: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((row) => row.textContent === text) ?? null;
}

async function choose(field: string, text: string): Promise<void> {
    await clickOn(document.querySelector(`[aria-label="${field}"]`));
    await until(() => option(text) !== null);
    await clickOn(option(text));
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('git.repos', () => ({ repos: [{ path: CWD, label: 'atlas', kind: 'root' as const }], truncated: false }));
    machine.answer('git.refs', () => ({
        current: 'main',
        stashes: [],
        refs: [
            { name: 'main', fullName: 'refs/heads/main', kind: 'local' as const, current: true, isDefault: true, at: 0, worktree: CWD },
            { name: 'left', fullName: 'refs/heads/left', kind: 'local' as const, current: false, isDefault: false, at: 0 },
            { name: 'right', fullName: 'refs/heads/right', kind: 'local' as const, current: false, isDefault: false, at: 0, worktree: '/work/elsewhere' }
        ]
    }));
    machine.answer('git.compare', () => comparison());
    machine.answer('git.compareCommits', () => ({
        commits: [{ hash: 'e'.repeat(40), shortHash: 'eeeeeee', subject: 'Older commit on left', author: 'Bas', at: 0, refs: [] }],
        next: null
    }));
    machine.answer('git.blob', ({ commit, path }) => ({ commit, path, text: commit === RIGHT ? 'head\nnew\n' : 'head\nold\n', language: 'typescript' }));
    workspace = await openFakeWorkspace(machine, { views: [CANVAS] }, { activeViewId: CANVAS.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => {
        closeBranchCompare();
        useFiles.setState({ tabs: [] });
        useUi.getState().setPaletteOpen(false);
    });
    await page.unmount();
    workspace.close();
});

test('the dialog compares a branch another worktree has out without switching to it', async () => {
    await act(async () => showBranchCompare());
    await until(() => buttonWithText('Compare')?.disabled === false);
    expect(document.querySelector('[aria-label="Base branch"]')?.textContent).toContain('main');
    await choose('Base branch', 'left');
    await clickOn(document.querySelector('[aria-label="Branch to compare"]'));
    await until(() => option('right (in another worktree)') !== null);
    // The branch this checkout has out is in git's worktree list too, but it is not another worktree.
    expect(option('main')).not.toBeNull();
    expect(option('main (in another worktree)')).toBeNull();
    await clickOn(option('right (in another worktree)'));
    await clickOn(buttonWithText('Compare'));
    await until(() => machine.requests('git.compare').length === 1);
    expect(machine.requests('git.compare')[0]).toEqual({ cwd: CWD, from: 'refs/heads/left', to: 'refs/heads/right', mode: 'merge-base' });
    await until(() => document.body.textContent?.includes('cart.ts') === true);
    expect(writes()).toEqual([]);
});

test('several repositories ask for one before any branch is read', async () => {
    machine.answer('git.repos', () => ({
        repos: [
            { path: `${CWD}/api`, label: 'api', kind: 'nested' as const },
            { path: `${CWD}/web`, label: 'web', kind: 'nested' as const }
        ],
        truncated: false
    }));
    await act(async () => showBranchCompare());
    await until(() => buttonWithText('Compare') !== null && document.querySelector('[aria-label="Repository"]')?.getAttribute('aria-disabled') !== 'true');
    expect(buttonWithText('Compare')?.disabled).toBe(true);
    const refsOfRepos = (): unknown[] => machine.requests('git.refs').filter(({ cwd }) => cwd !== CWD);

    expect(refsOfRepos()).toEqual([]);
    await choose('Repository', 'web');
    await until(() => buttonWithText('Compare')?.disabled === false);
    expect(refsOfRepos()).toEqual([{ cwd: `${CWD}/web` }]);
});

test('a seed from a branch row names that branch and the mode it asked for', async () => {
    await act(async () => showBranchCompare({ cwd: CWD, to: 'refs/heads/left', mode: 'tips' }));
    await until(() => buttonWithText('Compare')?.disabled === false);
    expect(document.querySelector('[aria-label="Branch to compare"]')?.textContent).toContain('left');
    expect(document.querySelector('[aria-label="Comparison"]')?.textContent).toContain('Difference between the two tips');
});

test('a machine without the request, and a machine that is gone, explain it and are not asked', async () => {
    machine.answersOnly(['git.refs', 'git.repos']);
    await act(async () => showBranchCompare());
    await until(() => document.body.textContent?.includes('too old to compare branches') === true);
    expect(machine.requests('git.compare')).toEqual([]);
    expect(machine.requests('git.refs')).toEqual([]);
    await act(async () => {
        closeBranchCompare();
        machine.drop();
    });
    await act(async () => showBranchCompare());
    await until(() => document.body.textContent?.includes('is not connected') === true);
});

test('the comparison shows its files and reads the unfoldable sides from the commits it resolved', async () => {
    await act(async () => openComparison(CWD, 'refs/heads/left', 'refs/heads/right', 'merge-base'));
    await until(() => document.body.textContent?.includes('cart.ts') === true);
    await until(() => machine.requests('git.blob').length === 2);
    expect(machine.requests('git.blob')).toEqual([
        { cwd: CWD, commit: BASE, path: 'cart.ts' },
        { cwd: CWD, commit: RIGHT, path: 'cart.ts' }
    ]);
    expect(document.body.textContent).toContain(`measured from the common ancestor ${BASE.slice(0, 7)}`);
});

test('commits only on one side page against the pinned commits', async () => {
    await act(async () => openComparison(CWD, 'refs/heads/left', 'refs/heads/right', 'merge-base'));
    await until(() => buttonWithText('Commits') !== null);
    await clickOn(buttonWithText('Commits'));
    await until(() => document.body.textContent?.includes('Only on left') === true);
    expect(document.body.textContent).toContain('No commits only on this branch.');
    await clickOn(buttonWithText('Show more commits'));
    await until(() => document.body.textContent?.includes('Older commit on left') === true);
    expect(machine.requests('git.compareCommits')).toEqual([{ cwd: CWD, fromCommit: LEFT, toCommit: RIGHT, side: 'left', skip: 1, limit: 30 }]);
    expect(buttonWithText('Show more commits')).toBeNull();
});

test('a mode switch keeps the commits it resolved after a branch moved, and Read again resolves the names anew', async () => {
    let moved = false;
    machine.answer('git.compare', ({ from, to, mode }) =>
        comparison({ from, to, mode, toCommit: moved && to === 'refs/heads/right' ? MOVED : RIGHT, baseCommit: mode === 'tips' ? LEFT : BASE })
    );
    await act(async () => openComparison(CWD, 'refs/heads/left', 'refs/heads/right', 'merge-base'));
    await until(() => document.body.textContent?.includes('measured from the common ancestor') === true);
    moved = true;
    await choose('Comparison', 'Difference between the two tips');
    await until(() => machine.requests('git.compare').length === 2);
    expect(machine.requests('git.compare')[1]).toEqual({ cwd: CWD, from: LEFT, to: RIGHT, mode: 'tips' });
    await clickOn(document.querySelector('button[aria-label="Read the branches again"]'));
    await until(() => machine.requests('git.compare').length === 3);
    expect(machine.requests('git.compare')[2]).toEqual({ cwd: CWD, from: 'refs/heads/left', to: 'refs/heads/right', mode: 'tips' });
    await until(() => document.body.textContent?.includes(MOVED.slice(0, 7)) === true);
    expect(writes()).toEqual([]);
});

test('a failed reading says why and tries again on request', async () => {
    let fail = true;
    machine.answer('git.compare', () => {
        if (fail) {
            throw new Error('These branches have no common ancestor. Compare their tips instead.');
        }
        return comparison();
    });
    await act(async () => openComparison(CWD, 'refs/heads/left', 'refs/heads/right', 'merge-base'));
    await until(() => document.body.textContent?.includes('no common ancestor') === true);
    fail = false;
    await clickOn(buttonWithText('Try again'));
    await until(() => document.body.textContent?.includes('cart.ts') === true);
    expect(machine.requests('git.compare')).toHaveLength(2);
});

test('opening a file on a side reads the commit and never the working copy', async () => {
    await act(async () => openComparison(CWD, 'refs/heads/left', 'refs/heads/right', 'merge-base'));
    await until(() => buttonWithText('Open on right') !== null);
    await clickOn(buttonWithText('Open on right'));
    await until(() => document.body.textContent?.includes('Read only. right at commit') === true);
    expect(machine.requests('git.blob').at(-1)).toEqual({ cwd: CWD, commit: RIGHT, path: 'cart.ts' });
    expect(machine.requests('fs.read').filter(({ path }) => path === `${CWD}/cart.ts`)).toEqual([]);
    expect(buttonWithText('Save')).toBeNull();
    expect(writes()).toEqual([]);
});

test('the common ancestor is its own side to open when the diff starts from it', async () => {
    await act(async () => openComparison(CWD, 'refs/heads/left', 'refs/heads/right', 'merge-base'));
    await until(() => buttonWithText('Open on common ancestor') !== null);
    await clickOn(buttonWithText('Open on common ancestor'));
    await until(() => machine.requests('git.blob').some(({ commit }) => commit === BASE) && document.body.textContent?.includes('Read only.') === true);
});

test('a snapshot says why an entry has no text', async () => {
    machine.answer('git.blob', ({ commit, path }) => ({ commit, path, omitted: 'gitlink' as const }));
    await act(async () => openSnapshot(CWD, RIGHT, 'right', 'vendor'));
    await until(() => document.body.textContent?.includes('This is a submodule') === true);
    expect(writes()).toEqual([]);
});

test('the palette has the command, and it opens the dialog', async () => {
    await act(async () => useUi.getState().setPaletteOpen(true));
    await until(() => document.querySelector('input[role="combobox"]') !== null);
    const search = document.querySelector<HTMLInputElement>('input[role="combobox"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(search, 'Compare branches');
        search.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Compare branches' }));
    });
    await until(() => [...document.querySelectorAll('[role="option"]')].some((row) => row.textContent?.includes('Compare branches')));
    await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes('Compare branches')) ?? null);
    await until(() => buttonWithText('Compare') !== null);
});

test('the branch menu opens the dialog on its current branch, and a branch row seeds that branch', async () => {
    machine.answer('git.status', () => ({
        repo: true,
        root: null,
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        base: 'main',
        mergeBase: null,
        files: [],
        truncated: false,
        live: true
    }));
    machine.answer('git.log', () => ({ commits: [], cursor: null }));
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'git' }));
    const chip = (): HTMLElement | null =>
        [...document.body.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')].find((candidate) => candidate.textContent?.startsWith('main')) ?? null;

    await until(() => chip() !== null);
    await clickOn(chip());
    await until(() => menuItem('Compare branches…') !== null);
    await clickOn(menuItem('Compare branches…'));
    await until(() => buttonWithText('Compare')?.disabled === false);
    expect(document.querySelector('[aria-label="Branch to compare"]')?.textContent).toContain('main');
    await clickOn(buttonWithText('Cancel'));
    await until(() => buttonWithText('Compare') === null);

    await clickOn(chip());
    await openSubmenu('Switch branch');
    await until(() => menuItem('left', 'menuitemradio') !== null);
    await act(async () => {
        menuItem('left', 'menuitemradio')!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true }));
    });
    await until(() => menuItem('Compare this branch…') !== null);
    await clickOn(menuItem('Compare this branch…'));
    await until(() => buttonWithText('Compare')?.disabled === false);
    expect(document.querySelector('[aria-label="Branch to compare"]')?.textContent).toContain('left');
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'git' }));
});
