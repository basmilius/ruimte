import { afterEach, expect, test } from 'bun:test';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';
import type { PageMetric } from './metrics';
import { measureWorkspaceLoadWith } from './workspace-load';

const MAIN = emptyCanvas();

let workspace: FakeWorkspace;
let page: Mounted;
let restore: () => void;

afterEach(async () => {
    await page.unmount();
    workspace.close();
    restore();
});

test('workspace.load runs from opening a project to the first frame of its workspace, with no attribute', async () => {
    let time = 10_000;
    const frames: (() => void)[] = [];
    const metrics: PageMetric[] = [];
    restore = measureWorkspaceLoadWith({ record: (metric) => metrics.push(metric), clock: { now: () => time, nextFrame: (run) => frames.push(run) } });

    const opening = openFakeWorkspace(new FakeMachine(), { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    time += 300;
    workspace = await opening;
    page = mount();
    await page.renderApp();
    await until(() => frames.length === 1);
    time += 50;
    frames[0]!();

    expect(metrics).toEqual([{ kind: 'distribution', name: 'workspace.load', value: 350, attributes: {} }]);
});
