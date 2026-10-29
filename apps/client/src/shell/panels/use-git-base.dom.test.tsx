import { afterEach, beforeEach, expect, test } from 'bun:test';
import { act } from 'react';
import { useGitSignal } from '@/state/git-watch';
import { windowWorkspace } from '@/state/window';
import { ConnectionProvider } from '@/transport/ConnectionProvider';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../../testing/dom';
import { useGitBase } from './use-git-base';

function Reader({ path, cwd }: { path: string; cwd: string }) {
    const base = useGitBase(path, 'disk');
    const checkout = useGitSignal(cwd);

    return <output data-checkout={checkout}>{base}</output>;
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

beforeEach(async () => {
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [] }, { activeViewId: null, views: {} });
    page = mount();
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

test.each([
    ['/watch-test', '/watch-test/src/file.txt', '/watch-test/src/other.txt', '/watch-test/src'],
    ['C:\\repo', 'C:\\repo\\src\\file.txt', 'C:\\repo\\src\\other.txt', 'C:\\repo\\src']
])('git base at %s refreshes only affected files while a checkout reader follows every change', async (cwd, path, other, directory) => {
    machine.answer('git.status', () => ({
        repo: true,
        root: cwd,
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
    }));
    machine.answer('git.diff', ({ path }) => ({ path: path ?? '', diff: '', oldText: 'base', added: 0, deleted: 0, binary: false }));
    await page.render(
        <ConnectionProvider connection={windowWorkspace()!.connection}>
            <Reader path={path} cwd={cwd} />
        </ConnectionProvider>
    );
    await until(() => page.host.querySelector('output')?.textContent === 'base');
    expect(machine.requests('git.diff')).toHaveLength(2);

    await act(async () => machine.emit('git.changed', { cwd, changedPaths: [other] }));
    expect(machine.requests('git.diff')).toHaveLength(2);
    expect(page.host.querySelector('output')?.dataset.checkout).toBe('1');

    for (const changedPaths of [[path], [directory], undefined]) {
        const before = machine.requests('git.diff').length;
        await act(async () => machine.emit('git.changed', { cwd, ...(changedPaths === undefined ? {} : { changedPaths }) }));
        await until(() => machine.requests('git.diff').length === before + 2);
    }
});
