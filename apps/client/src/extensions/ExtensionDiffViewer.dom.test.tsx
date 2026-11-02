import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { contribute } from '@/extensions/registry';
import { useFiles } from '@/state/files';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const CWD = '/work/atlas';
const FILE = `${CWD}/src/board.poc`;
const CANVAS = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], edges: [], texts: [], groups: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let removeViewer: () => void;
let reads = 0;

beforeEach(async () => {
    reads = 0;
    machine = new FakeMachine();
    machine.answer('git.diff', () => {
        reads += 1;

        return { path: 'src/board.poc', diff: `patch ${reads}`, added: 1, deleted: 1, binary: false };
    });
    removeViewer = contribute('diffViewers', {
        id: 'acme.poc/diff',
        title: 'Board',
        extensions: ['poc'],
        component: ({ diff }: { diff: string }) => <p data-testid="extension-diff">{diff}</p>
    });
    workspace = await openFakeWorkspace(machine, { views: [CANVAS] } as never, { activeViewId: CANVAS.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    removeViewer();
    await page.unmount();
    workspace.close();
});

function shown(): string | null {
    return document.querySelector('[data-testid="extension-diff"]')?.textContent ?? null;
}

describe("an extension's diff viewer", () => {
    test("reads the diff Ruimte's own viewer reads, and again when the checkout changes", async () => {
        await act(async () => useFiles.getState().open(FILE, 8, { kind: 'diff', cwd: CWD, scope: 'base', staged: true, base: 'main' }));
        await until(() => shown() === 'patch 1');

        expect(machine.requests('git.diff')[0]).toMatchObject({ cwd: CWD, path: 'src/board.poc', scope: 'base', staged: true, base: 'main' });

        await act(async () => machine.emit('git.changed', { cwd: CWD }));
        await until(() => shown() === 'patch 2');
    });
});
