import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { FsEntry, GitStatus } from '@ruimte/contracts';
import { act } from 'react';
import { useFilesRoot } from '@/state/files-root';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, menuItem } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const FOLDER = '/work/atlas';
const API = `${FOLDER}/api`;
const WEB = `${FOLDER}/web`;
const WORKTREE = '/home/bas/.ruimte/worktrees/atlas/lexer';
const MAIN = emptyCanvas();

const LISTINGS: Record<string, FsEntry[]> = {
    [FOLDER]: [directory(API), directory(WEB), file(`${FOLDER}/Makefile`)],
    [WORKTREE]: [file(`${WORKTREE}/lexer.ts`)]
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function entry(path: string, kind: FsEntry['kind']): FsEntry {
    return { name: path.slice(path.lastIndexOf('/') + 1), path, kind, size: kind === 'file' ? 0 : null, mtime: 0, hidden: false, ignored: false };
}

function file(path: string): FsEntry {
    return entry(path, 'file');
}

function directory(path: string): FsEntry {
    return entry(path, 'directory');
}

function status(branch: string, ahead = 0): GitStatus {
    return {
        repo: true,
        root: null,
        branch,
        detached: false,
        upstream: `origin/${branch}`,
        ahead,
        behind: 0,
        base: 'main',
        mergeBase: null,
        files: [],
        truncated: false,
        live: true
    };
}

/* The tree draws its rows in a shadow root of its own. */
function row(path: string): HTMLElement | null {
    const host = page.host.querySelector('.adecore-file-tree-host');
    return (host?.shadowRoot ?? host)?.querySelector<HTMLElement>(`[data-item-path="${path}"]`) ?? null;
}

/* The row under a filter, whose text ends in its shortcut. */
function findInFiles(): HTMLElement | null {
    return [...document.body.querySelectorAll<HTMLElement>('button')].find((candidate) => candidate.textContent?.startsWith('Find in files')) ?? null;
}

function chip(startsWith: string): HTMLElement | null {
    return (
        [...document.body.querySelectorAll<HTMLElement>('button[aria-haspopup="menu"]')].find((candidate) => candidate.textContent?.startsWith(startsWith)) ??
        null
    );
}

function filterField(): HTMLInputElement {
    return document.body.querySelector<HTMLInputElement>('input[aria-label="Filter files"]')!;
}

async function typeFilter(text: string): Promise<void> {
    await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(filterField(), text);
        filterField().dispatchEvent(new Event('input', { bubbles: true }));
    });
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('fs.list', ({ path }) => ({ path, entries: LISTINGS[path] ?? [], truncated: false }));
    machine.answer('git.repos', () => ({
        repos: [
            { path: API, label: 'api', kind: 'nested' as const },
            { path: WEB, label: 'web', kind: 'nested' as const }
        ],
        truncated: false
    }));
    machine.answer('git.status', ({ cwd }) => (cwd === API ? status('develop', 2) : cwd === WORKTREE ? status('lexer') : status('main')));
    machine.answer('git.worktree-list', () => ({ worktrees: [{ path: WORKTREE, branch: 'lexer' }] }));
    machine.answer('fs.search', () => ({ files: ['api/feeds.yaml', 'web/FeedList.vue'], truncated: false }));
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'files' }));
    await until(() => chip('2 repos') !== null && row('Makefile') !== null);
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'files' }));
    await page.unmount();
    workspace.close();
    useFilesRoot.setState({ picked: {} });
});

describe('the files panel', () => {
    test('a worktree picked in the chip roots the tree there, and Project goes back', async () => {
        await clickOn(chip('2 repos'));
        await until(() => menuItem('lexer') !== null);
        await clickOn(menuItem('lexer'));
        await until(() => row('lexer.ts') !== null);
        expect(machine.requests('fs.list')).toContainEqual({ path: WORKTREE, hidden: true });
        expect(chip('lexer')).not.toBeNull();
        expect(row('Makefile')).toBeNull();

        await typeFilter('lex');
        await until(() => machine.requests('fs.search').length > 0);
        expect(machine.requests('fs.search').at(-1)).toEqual({ cwd: WORKTREE, query: 'lex', limit: 200 });
        await typeFilter('');

        await clickOn(buttonWithText('Project'));
        await until(() => row('Makefile') !== null);
        expect(chip('2 repos')).not.toBeNull();
        expect(buttonWithText('Project')).toBeNull();
    });

    test('a filter says how many files match and hands its words on to find in files', async () => {
        expect(findInFiles()).toBeNull();
        await act(async () => filterField().focus());
        await typeFilter('Feed');
        await until(() => document.body.querySelector('[aria-label="2 matches"]') !== null);
        expect(document.activeElement).toBe(filterField());
        expect(machine.requests('fs.search').at(-1)).toEqual({ cwd: FOLDER, query: 'Feed', limit: 200 });
        await clickOn(findInFiles());
        expect(useUi.getState().paletteMode).toBe('grep');
        expect(useUi.getState().paletteSeed).toBe('Feed');

        await clickOn(document.body.querySelector<HTMLElement>('button[aria-label="Clear filter"]'));
        expect(filterField().value).toBe('');
        await act(async () => useUi.getState().setPaletteOpen(false));
    });

    test('a repository of the folder shows its branch and how far it is ahead', async () => {
        const decorations = (): string => [...page.host.querySelectorAll('.adecore-tree-decoration')].map((element) => element.textContent).join('|');
        await until(() => decorations().includes('develop'));
        expect(decorations()).toContain('main');
        expect(page.host.querySelector('[aria-label="2 commits to push"]')).not.toBeNull();
    });

    test('a folder says it is empty once it opened and its listing came back with nothing', async () => {
        const emptyLine = (): HTMLElement | null =>
            page.host.querySelector('.adecore-file-tree-host')?.shadowRoot?.querySelector<HTMLElement>('[data-empty-line="true"]') ?? null;
        expect(emptyLine()).toBeNull();
        await clickOn(row('web/'));
        await until(() => emptyLine() !== null);
        expect(emptyLine()!.querySelector<HTMLElement>('[data-item-section="content"]')?.dataset.emptyLabel).toBe('Empty folder');
        expect(machine.requests('fs.list').some((request) => request.path === WEB)).toBe(true);
        await clickOn(row('web/'));
        await until(() => emptyLine() === null);
    });
});
