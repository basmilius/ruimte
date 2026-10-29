import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { REQUEST_SCHEMAS, type ArtifactCleanupProposal, type ArtifactStorageResult, type RequestType } from '@ruimte/contracts';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { buttonWithText, everything } from '../../../testing/dom-helpers';
import { emptyCanvas } from '../../../testing/project-fixtures';

const MAIN = emptyCanvas();
const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const START = Date.UTC(2026, 6, 24, 7);

const STORAGE: ArtifactStorageResult = {
    projects: [
        { projectId: 'project-chats', projectName: 'Chats', artifacts: 1, versions: 30, bytes: 33 * MB },
        { projectId: 'project-atlas', projectName: 'Atlas', artifacts: 8, versions: 163, bytes: 700 * MB }
    ],
    total: { artifacts: 9, versions: 193, bytes: 733 * MB },
    disk: { free: 388 * 1024 * MB, size: 1024 * 1024 * MB }
};

const SUMMARY: ArtifactCleanupProposal = {
    id: 'morning',
    artifactId: 'morning',
    title: 'Morning summary',
    versions: [1, 2, 3].map((number) => ({ versionId: `m-${number}`, number, createdAt: START + number * DAY, bytes: 4 * MB })),
    bytes: 12 * MB
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function openStorage(): Promise<void> {
    await act(async () => useUi.getState().setSettings({ open: true, section: 'machines', target: 'machines.machine.storage.output' }));
}

beforeEach(async () => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('artifact.storage', () => STORAGE);
    machine.answer('artifact.cleanup', (payload) =>
        payload.mode === 'preview' ? { proposals: [SUMMARY] } : { removed: payload.versions.length, freedBytes: payload.versions.length * 4 * MB }
    );
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false, target: null }));
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'files' }));
    await page.unmount();
    workspace.close();
});

describe('the Storage pane', () => {
    test('shows what the machine keeps, a bar per project and what is free', async () => {
        await openStorage();
        await until(() => everything().includes('Output on Fake machine'));
        expect(everything()).toContain('733 MB');
        expect(everything()).toContain('388 GB free on the disk');
        expect(document.querySelector('[aria-label="Output by project"]')?.querySelectorAll('li')).toHaveLength(2);
        // The largest project first.
        expect(everything().indexOf('Atlas')).toBeLessThan(everything().indexOf('Chats'));
        expect(everything()).toContain('8 items, 163 versions');
    });

    test('Show in Output opens the panel on this project, and on All projects for another one', async () => {
        await openStorage();
        await until(() => everything().includes('Show in Output'));
        // Atlas is the window's project and comes first; Chats is another one of this machine.
        await clickOn([...document.querySelectorAll('button')].filter((element) => element.textContent?.trim() === 'Show in Output')[1] ?? null);
        expect(useUi.getState().settings.open).toBe(false);
        expect(useUi.getState().panel.open && useUi.getState().panel.kind).toBe('output');
        await until(() => everything().includes('All projects'));

        await openStorage();
        await until(() => everything().includes('Show in Output'));
        await clickOn(buttonWithText('Show in Output'));
        await until(() => !everything().includes('All projects'));
    });

    test('Review removes exactly the versions left checked', async () => {
        await openStorage();
        await until(() => everything().includes('Older versions of Morning summary'));
        expect(everything()).toContain('Frees 12 MB, 3 versions');
        await clickOn(buttonWithText('Review'));
        await until(() => document.querySelector('[role="dialog"] [role="checkbox"][aria-label="Version 2"]') !== null);
        await clickOn(document.querySelector('[role="checkbox"][aria-label="Version 2"]'));
        await until(() => buttonWithText('Remove 2 versions') !== null);
        await clickOn(buttonWithText('Remove 2 versions'));
        await until(() => machine.requests('artifact.cleanup').some((payload) => payload.mode === 'confirm'));
        expect(machine.requests('artifact.cleanup').find((payload) => payload.mode === 'confirm')).toEqual({
            mode: 'confirm',
            versions: [
                { artifactId: 'morning', versionId: 'm-1' },
                { artifactId: 'morning', versionId: 'm-3' }
            ]
        });
        await until(() => everything().includes('8 MB freed on Fake machine'));
    });

    test('Not now puts a proposal away for this session', async () => {
        await openStorage();
        await until(() => everything().includes('Older versions of Morning summary'));
        await clickOn(buttonWithText('Not now'));
        await until(() => everything().includes('Nothing to clean up'));
        expect(machine.requests('artifact.cleanup').every((payload) => payload.mode === 'preview')).toBe(true);
    });

    test('a machine with nothing to let go says so', async () => {
        machine.answer('artifact.cleanup', () => ({ proposals: [] }));
        await openStorage();
        await until(() => everything().includes('Nothing to clean up'));
    });

    test('a machine that does not keep Output asks for an update and is never asked', async () => {
        const all = Object.keys(REQUEST_SCHEMAS) as RequestType[];
        machine.answersOnly(all.filter((type) => !type.startsWith('artifact.')));
        await openStorage();
        await until(() => everything().includes('Update Fake machine to use Output.'));
        expect(machine.requests('artifact.storage')).toHaveLength(0);
    });

    test('a machine that does not answer says so', async () => {
        await openStorage();
        await until(() => everything().includes('Output on Fake machine'));
        await act(async () => machine.lose());
        await until(() => everything().includes('Fake machine is not reachable.'));
        expect(everything()).not.toContain('Show in Output');
    });
});
