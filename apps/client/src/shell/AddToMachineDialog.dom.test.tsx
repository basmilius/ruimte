import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { GitIgnoredFilesResult, ProjectSummary } from '@ruimte/contracts';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useUi } from '@/state/ui';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';

const REMOTE = 'machine-b';

const IGNORED: GitIgnoredFilesResult = {
    root: '/work/atlas',
    prefix: '',
    truncated: false,
    files: [
        { path: '.env', size: 6, link: false, mode: 0o600 },
        { path: 'config.local.json', size: 2, link: false },
        { path: 'dump.sql', size: 5 * 1024 * 1024, link: false },
        { path: 'current', size: 4, link: true }
    ]
};

function summary(projectId: string, folder: string): ProjectSummary {
    return {
        projectId,
        name: 'atlas',
        color: '#000',
        folder,
        lastOpenedAt: 0,
        closedAt: null,
        available: true,
        icon: { kind: 'initial', value: 'a' },
        nameSource: 'chosen'
    };
}

let here: FakeMachine;
let there: FakeMachine;
let workspace: FakeWorkspace;
let disconnectThere: () => void;
let page: Mounted;
let remoteUrl: string | undefined;
let cloneFails: boolean;

function dialog(): HTMLElement | null {
    return document.querySelector('[role="dialog"]');
}

function text(): string {
    return dialog()?.textContent ?? '';
}

function button(label: string): HTMLButtonElement | null {
    return ([...(dialog()?.querySelectorAll('button') ?? [])] as HTMLButtonElement[]).find((candidate) => candidate.textContent?.trim() === label) ?? null;
}

beforeEach(async () => {
    remoteUrl = 'git@github.com:basmilius/atlas.git';
    cloneFails = false;
    here = new FakeMachine();
    there = new FakeMachine();
    here.answer('git.ignoredFiles', () => IGNORED);
    here.answer('git.identity', ({ paths }) => ({
        identities: paths.map((path) => ({ path, rootCommits: ['root-a'], branch: 'main', heads: [], ...(remoteUrl === undefined ? {} : { remoteUrl }) }))
    }));
    here.answer('fs.read', ({ path }) => ({ kind: 'text' as const, text: `contents of ${path}`, encoding: 'utf-8' as const, size: 6, mtime: 1 }));
    there.answer('fs.browse', () => ({ parentPath: '/Users/b/', entries: [] }) as never);
    there.answer('git.clone', ({ actionId, path }) => {
        there.emit('git.progress', { cwd: path, actionId, phase: 'fetch', line: 'Receiving objects:  50% (1/2)' });
        if (cloneFails) {
            cloneFails = false;
            throw new Error('fatal: Could not read from remote repository.');
        }
        return { path, output: '' };
    });
    there.answer('project.open', ({ folder }) => ({ summary: summary('atlas-b', folder ?? '') }) as never);
    there.answer('fs.create', () => ({ size: 1, mtime: 1 }) as never);
    useEndpoints.getState().add({
        id: REMOTE,
        label: 'MacBook Pro',
        httpBaseUrl: 'http://127.0.0.1:2',
        wsBaseUrl: 'ws://127.0.0.1:2',
        reachability: 'lan',
        daemonId: null,
        daemonPublicKey: null
    });
    disconnectThere = connectFakeMachine(there, REMOTE);
    workspace = await openFakeWorkspace(here, { views: [] }, { activeViewId: null, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setAddToMachineDialog(null));
    await page.unmount();
    workspace.close();
    disconnectThere();
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
});

async function chooseFolder(): Promise<void> {
    await until(() => button('Choose…')?.disabled === false);
    await clickOn(button('Choose…'));
    await until(() => button('Use this folder')?.disabled === false);
    await clickOn(button('Use this folder'));
    await until(() => text().includes('/Users/b/'));
}

describe('adding a project to another machine', () => {
    test('clones it there over the protocol picked, then copies the ignored files a person chose', async () => {
        await act(async () => useUi.getState().setAddToMachineDialog({ machineId: REMOTE }));
        await until(() => text().includes('git@github.com:basmilius/atlas.git'));
        await chooseFolder();
        await until(() => text().includes('Clones into /Users/b/atlas'));
        await clickOn(dialog()!.querySelector('[role="radio"][aria-checked="false"]'));
        await until(() => text().includes('https://github.com/basmilius/atlas.git'));

        await clickOn(button('Clone'));
        await until(() => text().includes('Choose which to copy'));
        expect(there.requests('git.clone')).toEqual([{ actionId: expect.any(String), url: 'https://github.com/basmilius/atlas.git', path: '/Users/b/atlas' }]);
        expect(text()).toContain('Over 1 MB, not copied');
        expect(text()).toContain('Link, not copied');

        await clickOn(button('Copy 1 file'));
        await until(() => text().includes('Copied 1 file.'));
        expect(here.requests('fs.read')).toEqual([{ path: '/work/atlas/.env' }]);
        expect(there.requests('fs.create')).toEqual([
            { path: '/Users/b/atlas/.env', kind: 'file', text: 'contents of /work/atlas/.env', overwrite: true, mode: 0o600 }
        ]);
        // Opened once to be listed there and once to be written in, and let go both times.
        expect(there.requests('project.open')).toEqual([{ folder: '/Users/b/atlas' }, { folder: '/Users/b/atlas' }]);
        expect(there.requests('project.release')).toEqual([{ projectId: 'atlas-b' }, { projectId: 'atlas-b' }]);
        expect(text()).toContain('MacBook Pro has the project in /Users/b/atlas.');
    });

    test('a clone that fails says why and goes again on Try again', async () => {
        cloneFails = true;
        await act(async () => useUi.getState().setAddToMachineDialog({ machineId: REMOTE }));
        await chooseFolder();
        await until(() => button('Clone')?.disabled === false);
        await clickOn(button('Clone'));
        await until(() => text().includes('fatal: Could not read from remote repository.'));
        await clickOn(button('Try again'));
        await until(() => text().includes('Choose which to copy'));
        expect(there.requests('git.clone')).toHaveLength(2);
    });

    test('a repository without a remote has nothing to clone from', async () => {
        remoteUrl = undefined;
        await act(async () => useUi.getState().setAddToMachineDialog({ machineId: REMOTE }));
        await until(() => text().includes('This repository has no remote'));
        await chooseFolder();
        expect(button('Clone')?.disabled).toBe(true);
    });

    test('a node waiting on the clone opens again once it is in', async () => {
        const then = { machineId: REMOTE, kind: 'chat' as const, viewId: 'main', at: null, relink: false };
        await act(async () => useUi.getState().setAddToMachineDialog({ machineId: REMOTE, then }));
        await chooseFolder();
        await until(() => button('Clone')?.disabled === false);
        await clickOn(button('Clone'));
        await until(() => button('Skip') !== null);
        await clickOn(button('Skip'));
        await clickOn(button('Continue'));
        expect(useUi.getState().addToMachineDialog).toBeNull();
        expect(useUi.getState().remoteNodeDialog).toEqual(then);
        await act(async () => useUi.getState().setRemoteNodeDialog(null));
    });
});
