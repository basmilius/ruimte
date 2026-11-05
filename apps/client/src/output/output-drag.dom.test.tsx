import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { ArtifactGetResult, ArtifactSummary, ArtifactVersion } from '@ruimte/contracts';
import { act } from 'react';
import { useDocument } from '@/state/document';
import { artifactTabKey, useFiles } from '@/state/files';
import { useUi } from '@/state/ui';
import { windowWorkspace } from '@/workspace/window';
import { mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const NOW = new Date(2026, 9, 25, 12, 0).getTime();
const VERSION: ArtifactVersion = {
    versionId: 'v-new',
    number: 1,
    createdAt: NOW,
    files: [{ name: 'report.md', mime: 'text/markdown', size: 9, sha256: 'hash' }],
    bytes: 9,
    provenance: { maker: 'agent', machineId: 'mac' },
    copiedTo: []
};
const ARTIFACT = { artifactId: 'deps', projectId: 'project-atlas', projectName: 'Atlas', title: 'Dependency report', kind: 'report', createdAt: NOW };
const SUMMARY: ArtifactSummary = { ...ARTIFACT, latest: VERSION, versionCount: 1, totalBytes: 9 };
const RESULT: ArtifactGetResult = { artifact: ARTIFACT, versions: [VERSION], chatPresent: false };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* What a browser hands the page for a drag: one transfer from the start of the gesture to its drop. */
async function drag(from: Element, to: Element): Promise<void> {
    const dataTransfer = new DataTransfer();
    const fire = (target: Element, type: string): void => {
        const event = new Event(type, { bubbles: true, cancelable: true });
        Object.defineProperty(event, 'dataTransfer', { value: dataTransfer });
        target.dispatchEvent(event);
    };
    await act(async () => {
        fire(from, 'dragstart');
        fire(to, 'dragover');
        fire(to, 'drop');
        fire(from, 'dragend');
    });
}

function outputRow(): HTMLElement {
    return ([...page.host.querySelectorAll('section button')] as HTMLElement[]).find((button) => button.textContent?.startsWith('Dependency report'))!;
}

beforeEach(async () => {
    setSystemTime(NOW);
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('artifact.list', () => ({ artifacts: [SUMMARY] }));
    machine.answer('artifact.get', () => RESULT);
    machine.answer('bytes.read', ({ offset }) => ({ mime: 'text/markdown', size: 9, version: 'v', offset, data: btoa('# Report\n'.slice(offset)) }));
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'output' }));
    await until(() => (page.host.textContent ?? '').includes('Dependency report'));
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'files' }));
    await page.unmount();
    workspace.close();
    useFiles.setState({ tabs: [] });
    setSystemTime();
});

describe('an Output row dragged out of the panel', () => {
    test('onto the sidebar becomes a view of the project that stays private', async () => {
        await drag(outputRow(), page.host.querySelector('[data-sidebar-row="view:main"]')!);
        await until(() => useDocument.getState().views.some((view) => view.kind === 'artifact'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        await until(() => machine.requests('project.save').some((save) => save.content.views.some((view) => view.kind === 'artifact')));
        const save = machine.requests('project.save').findLast((candidate) => candidate.content.views.some((view) => view.kind === 'artifact'))!;
        const view = save.content.views.find((candidate) => candidate.kind === 'artifact')!;
        expect(view).toMatchObject({ kind: 'artifact', name: 'Dependency report', node: { artifact: { id: 'deps' } } });
        expect(save.shared).not.toContain(view.id);
        expect(page.host.querySelector(`[data-sidebar-row="view:${view.id}"]`)?.textContent).toContain('Dependency report');
    });

    test('onto the stage opens its view in the cell it lands on', async () => {
        await drag(outputRow(), page.host.querySelector('[data-cell-bar]')!);
        await until(() => useFiles.getState().tabs.some((tab) => tab.key === artifactTabKey('deps')));
        await until(() => page.host.querySelector('button[aria-label="Versions"]') !== null);
        expect(useDocument.getState().views.some((view) => view.kind === 'artifact')).toBe(false);
    });
});
