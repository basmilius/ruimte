import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import type { GitCompareResult } from '@ruimte/contracts';
import { useFiles, isSessionTab } from '@/state/files';
import { useUi } from '@/state/ui';
import { isApplePlatform } from '@/desktop/bridge';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { buttonWithText } from '../../../testing/dom-helpers';
import { clickOn, mount, pressKey, until, type Mounted } from '../../../testing/dom';
import { showBranchCompare, closeBranchCompare, openComparison, openSnapshot } from './branch-compare';

const CWD = '/work/atlas';
const LEFT = 'a'.repeat(40);
const RIGHT = 'b'.repeat(40);
const BASE = 'c'.repeat(40);
const PATCH = 'diff --git a/cart.ts b/cart.ts\n--- a/cart.ts\n+++ b/cart.ts\n@@ -1,2 +1,2 @@\n head\n-old\n+new\n';
const CANVAS = { kind: 'canvas' as const, id: 'main', name: 'Main', nodes: [], edges: [], texts: [], layouts: [] };
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function comparison(): GitCompareResult {
    return {
        cwd: CWD,
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
        left: { commits: [{ hash: LEFT, shortHash: 'aaaaaaa', subject: 'Only on left', author: 'Bas', at: 0, refs: [] }], next: 30 },
        right: { commits: [], next: null }
    };
}

function forbiddenWrites(): unknown[] {
    return machine.sent.filter(({ type }) => type === 'git.action' || type === 'fs.write' || type === 'fs.rename' || type === 'fs.delete');
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('git.repos', () => ({ repos: [{ path: CWD, label: 'Atlas', kind: 'root' as const }], truncated: false }));
    machine.answer('git.refs', () => ({
        current: 'main',
        stashes: [],
        refs: [
            { name: 'left', fullName: 'refs/heads/left', kind: 'local' as const, current: false, isDefault: true, at: 0 },
            { name: 'right', fullName: 'refs/heads/right', kind: 'local' as const, current: false, isDefault: false, at: 0, worktree: '/work/elsewhere' }
        ]
    }));
    machine.answer('git.compare', () => comparison());
    machine.answer('git.compareCommits', () => ({
        commits: [{ hash: 'd'.repeat(40), shortHash: 'ddddddd', subject: 'Older left commit', author: 'Bas', at: 0, refs: [] }],
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
        useUi.getState().setPaletteOpen(false);
    });
    await page.unmount();
    workspace.close();
});

test('the palette opens the picker, which accepts branches checked out elsewhere without switching', async () => {
    await act(async () => useUi.getState().setPaletteOpen(true));
    await until(() => document.querySelector<HTMLInputElement>('[cmdk-input], input[role="combobox"]') !== null);
    const input = document.querySelector<HTMLInputElement>('[cmdk-input], input[role="combobox"]')!;
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, 'Compare branches');
        input.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'Compare branches' }));
    });
    await until(() => document.body.textContent?.includes('Compare branches…') === true);
    const row = [...document.querySelectorAll<HTMLElement>('[role="option"]')].find((item) => item.textContent?.includes('Compare branches'));
    await clickOn(row ?? null);
    await until(() => buttonWithText('Compare') !== null);
    await until(() => buttonWithText('Compare')?.disabled === false);
    await clickOn(document.querySelector('[aria-label="To"]'));
    await until(() => [...document.querySelectorAll('[role="option"]')].some((row) => row.textContent?.includes('right')));
    await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent?.includes('right')) ?? null);
    await clickOn(buttonWithText('Compare'));
    await until(() => machine.requests('git.compare').length === 1);
    expect(machine.requests('git.compare')[0]).toMatchObject({ cwd: CWD, from: 'refs/heads/left', to: 'refs/heads/right' });
    expect(forbiddenWrites()).toEqual([]);
});

test('a comparison pages pinned history and opens a right-hand snapshot at the caret without reading the work file', async () => {
    await act(async () => openComparison(CWD, 'refs/heads/left', 'refs/heads/right', 'merge-base'));
    await until(() => document.querySelector('.file-diff textarea') !== null);
    await clickOn(buttonWithText('Unique commits'));
    await until(() => buttonWithText('Load more commits') !== null);
    await clickOn(buttonWithText('Load more commits'));
    await until(() => document.body.textContent?.includes('Older left commit') === true);
    expect(machine.requests('git.compareCommits')).toEqual([{ cwd: CWD, fromCommit: LEFT, toCommit: RIGHT, side: 'left', skip: 30, limit: 30 }]);
    await clickOn(buttonWithText('Files (1)'));
    const input = document.querySelector<HTMLTextAreaElement>('.file-diff textarea')!;
    await act(async () => input.focus());
    await pressKey(input, 'ArrowDown');
    await pressKey(input, 'ArrowDown');
    await pressKey(input, 'ArrowDown', isApplePlatform() ? { metaKey: true } : { ctrlKey: true });
    await until(() => useFiles.getState().tabs.some((tab) => isSessionTab(tab) && tab.kind === 'snapshot'));
    await until(() => document.body.textContent?.includes('Read-only Git snapshot.') === true);
    expect(useFiles.getState().tabs.find((tab) => isSessionTab(tab) && tab.kind === 'snapshot')).toMatchObject({ commit: RIGHT, path: 'cart.ts' });
    expect(machine.requests('fs.read').filter(({ path }) => path === `${CWD}/cart.ts`)).toEqual([]);
    expect(forbiddenWrites()).toEqual([]);
    expect(useFiles.getState().tabs.filter(isSessionTab)).toHaveLength(2);
});

test('old machines and disconnected machines explain the unavailable read without sending it', async () => {
    machine.connection = { ...machine.connection, features: [] };
    await act(async () => showBranchCompare());
    await until(() => document.body.textContent?.includes('Update this machine to compare branches') === true);
    expect(machine.requests('git.compare')).toEqual([]);
    await act(async () => machine.drop());
    await until(() => document.body.textContent?.includes('Connect to this machine to read') === true);
});

test('snapshot omissions are explicit and expose no working-file actions', async () => {
    machine.answer('git.blob', ({ commit, path }) => ({ commit, path, omitted: 'gitlink' as const }));
    await act(async () => openSnapshot(CWD, RIGHT, 'right', 'vendor'));
    await until(() => document.body.textContent?.includes('Submodule reference. No file content') === true);
    expect(buttonWithText('Save')).toBeNull();
    expect(forbiddenWrites()).toEqual([]);
});

test('mode changes and explicit refresh reread the refs, and a failed read can be retried', async () => {
    let fail = true;
    machine.answer('git.compare', ({ mode }) => {
        if (fail) {
            throw new Error('This repository has no common ancestor. Choose Tips.');
        }
        return { ...comparison(), mode, baseCommit: mode === 'tips' ? LEFT : BASE };
    });
    await act(async () => openComparison(CWD, 'refs/heads/left', 'refs/heads/right', 'merge-base'));
    await until(() => document.body.textContent?.includes('This repository has no common ancestor') === true);
    fail = false;
    await clickOn(document.querySelector('[aria-label="Comparison"]'));
    await until(() => [...document.querySelectorAll('[role="option"]')].some((row) => row.textContent === 'Branch tips'));
    await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent === 'Branch tips') ?? null);
    await until(() => document.body.textContent?.includes('Branch tip aaaaaaa → bbbbbbb') === true);
    expect(machine.requests('git.compare').map(({ mode }) => mode)).toEqual(['merge-base', 'tips']);
    const refresh = [...document.querySelectorAll<HTMLButtonElement>('button')].find((button) => button.textContent === 'Read again');
    await clickOn(refresh ?? null);
    await until(() => machine.requests('git.compare').length === 3);
    expect(forbiddenWrites()).toEqual([]);
});

test('several repositories require a choice before either branch list is read', async () => {
    machine.answer('git.repos', () => ({
        repos: [
            { path: `${CWD}/api`, label: 'API', kind: 'nested' as const },
            { path: `${CWD}/web`, label: 'Web', kind: 'nested' as const }
        ],
        truncated: false
    }));
    await act(async () => showBranchCompare());
    await until(() => document.querySelector('[aria-label="Repository"]')?.getAttribute('aria-disabled') !== 'true' && buttonWithText('Compare') !== null);
    expect(buttonWithText('Compare')?.disabled).toBe(true);
    expect(machine.requests('git.refs')).toEqual([]);
    await clickOn(document.querySelector('[aria-label="Repository"]'));
    await until(() => [...document.querySelectorAll('[role="option"]')].some((row) => row.textContent === 'Web'));
    await clickOn([...document.querySelectorAll('[role="option"]')].find((row) => row.textContent === 'Web') ?? null);
    await until(() => buttonWithText('Compare')?.disabled === false);
    expect(machine.requests('git.refs')).toEqual([{ cwd: `${CWD}/web` }]);
});

test('text snapshots ignore native input changes and expose no work-file save or drag data', async () => {
    await act(async () => openSnapshot(CWD, RIGHT, 'right', 'cart.ts'));
    await until(() => document.querySelector('textarea') !== null);
    const editor = document.querySelector<HTMLTextAreaElement>('textarea')!;
    await act(async () => editor.focus());
    const before = editor.value;
    await act(async () => {
        editor.value = before + 'changed';
        editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: 'changed' }));
    });
    expect(editor.value).toBe(before);
    await pressKey(editor, 's', isApplePlatform() ? { metaKey: true } : { ctrlKey: true });
    expect(machine.requests('fs.write')).toEqual([]);
    expect(machine.requests('fs.read').filter(({ path }) => path === `${CWD}/cart.ts`)).toEqual([]);
    expect(document.body.textContent).toContain('Read-only Git snapshot.');
    expect(document.querySelector('[data-path="/work/atlas/cart.ts"]')).toBeNull();
});
