import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { GitFile, GitRepo, GitStatus, ProjectCanvasView } from '@ruimte/contracts';
import type { DesktopBridge } from '@/desktop/bridge';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const FOLDER = '/work/atlas';
const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function file(path: string, state: GitFile['state']): GitFile {
    return { path, state, status: state === 'untracked' ? '?' : 'M', added: 1, deleted: 0, binary: false };
}

function status(files: GitFile[]): GitStatus {
    return {
        repo: true,
        root: FOLDER,
        branch: 'main',
        detached: false,
        upstream: 'origin/main',
        ahead: 0,
        behind: 0,
        base: 'main',
        mergeBase: null,
        files,
        truncated: false,
        live: true
    };
}

function gitButton(): HTMLButtonElement | null {
    return document.querySelector<HTMLButtonElement>('header button[aria-label^="Git"]');
}

function dotOn(button: HTMLButtonElement | null): boolean {
    return button?.querySelector('span[aria-hidden="true"].rounded-full') != null;
}

const scope = globalThis as unknown as { window: { ruimteDesktop?: DesktopBridge } };
const ROOT: GitRepo = { path: FOLDER, label: 'atlas', kind: 'root' };

let repos: GitRepo[];

async function open(options: { thisMachine: boolean }): Promise<void> {
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} }, {}, options);
    page = mount();
    await page.renderApp();
}

/* A few turns for the requests a render sends, so a request that never went out can be told from one still on its way. */
async function settle(): Promise<void> {
    for (let i = 0; i < 5; i++) {
        await act(async () => undefined);
    }
}

beforeEach(() => {
    localStorage.clear();
    repos = [ROOT];
    scope.window.ruimteDesktop = {
        platform: 'darwin',
        pickFolder: async () => null,
        openExternal: async () => undefined,
        openGuestDevTools: () => undefined,
        isFullscreen: async () => false,
        onFullscreen: () => () => undefined
    };
    machine = new FakeMachine();
    machine.answer('git.repos', () => ({ repos, truncated: false }));
    machine.answer('git.watch', ({ cwd }) => ({ status: status(cwd === FOLDER ? [file('README.md', 'unstaged'), file('notes.md', 'untracked')] : []) }));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    delete scope.window.ruimteDesktop;
});

describe('the git button in the toolbar', () => {
    test('carries a dot and says how many changes the checkout has while the panel is closed', async () => {
        await open({ thisMachine: true });
        await until(() => gitButton()?.getAttribute('aria-label') === 'Git, 2 changes');
        expect(dotOn(gitButton())).toBe(true);
        expect(machine.requests('git.watch')).toContainEqual({ cwd: FOLDER, status: true });
    });

    test('loses the dot once the checkout is clean again', async () => {
        await open({ thisMachine: true });
        await until(() => dotOn(gitButton()));
        await act(async () => machine.emit('git.status', { cwd: FOLDER, status: status([]) }));
        await until(() => gitButton()?.getAttribute('aria-label') === 'Git');
        expect(dotOn(gitButton())).toBe(false);
    });

    test('watches nothing for a folder that is no git repository', async () => {
        repos = [];
        await open({ thisMachine: true });
        await until(() => machine.requests('git.repos').length > 0);
        await settle();
        expect(machine.requests('git.watch')).toEqual([]);
        expect(gitButton()?.getAttribute('aria-label')).toBe('Git');
    });

    test("watches nothing for a project on another machine, where the watch would hold that machine's checkout", async () => {
        await open({ thisMachine: false });
        await until(() => gitButton() !== null);
        await settle();
        expect(machine.requests('git.watch')).toEqual([]);
        expect(dotOn(gitButton())).toBe(false);
    });
});
