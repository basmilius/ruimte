import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import type { ArtifactGetResult, ArtifactSummary, ArtifactVersion, RemoteLink } from '@ruimte/contracts';
import { act } from 'react';
import { openArtifact } from '@/output/open';
import { LOCAL_ENDPOINT_ID, useEndpoints } from '@/state/endpoints';
import { useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { TransportError } from '@/transport/transport';
import { clickOn, mount, openSubmenu, pressKey, until, type Mounted } from '../../testing/dom';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
const REMOTE = 'machine-b';
const NOW = new Date(2026, 9, 25, 12, 0).getTime();
const LINK: RemoteLink = { machineId: REMOTE, remoteProjectId: 'remote-atlas', label: 'MacBook Pro', rootCommit: 'root' };

const VERSION: ArtifactVersion = {
    versionId: 'ver-remote',
    number: 1,
    createdAt: NOW,
    files: [{ name: 'notes.bin', mime: 'application/octet-stream', size: 10, sha256: 'hash' }],
    bytes: 10,
    provenance: { maker: 'agent', machineId: REMOTE },
    copiedTo: []
};
const ARTIFACT = { artifactId: 'art-remote', projectId: 'remote-atlas', projectName: 'Atlas', title: 'Release notes', kind: 'build', createdAt: NOW };
const SUMMARY: ArtifactSummary = { ...ARTIFACT, latest: VERSION, versionCount: 1, totalBytes: 10 };
const REMOTE_RESULT: ArtifactGetResult = { artifact: ARTIFACT, versions: [VERSION], chatPresent: false };

let here: FakeMachine;
let there: FakeMachine;
let links: RemoteLink[];
let workspace: FakeWorkspace;
let page: Mounted;
let disconnectThere: () => void;

function text(): string {
    return document.body.textContent ?? '';
}

function barButton(label: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
}

function menuItemNamed(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim() === label) ?? null;
}

/* The artifact view's actions, behind the last button of its bar. */
async function openMore(): Promise<void> {
    await until(() => barButton('Versions') !== null);
    await clickOn(barButton('More'));
    await until(() => document.querySelector('[role="menu"]') !== null);
}

beforeEach(async () => {
    setSystemTime(NOW);
    localStorage.clear();
    links = [LINK];
    here = new FakeMachine();
    here.answer('artifact.list', () => ({ artifacts: [] }));
    here.answer('remote.list', () => ({ links }));
    here.answer('artifact.importFrom', () => ({ artifactId: 'art-copy', versionId: 'ver-copy' }));
    here.answer('artifact.get', () => ({
        artifact: { ...ARTIFACT, artifactId: 'art-copy', projectId: 'project-atlas' },
        versions: [
            {
                ...VERSION,
                versionId: 'ver-copy',
                origin: { machineId: REMOTE, artifactId: 'art-remote', versionId: 'ver-remote', provenance: VERSION.provenance, hashes: ['hash'] }
            }
        ],
        chatPresent: false
    }));
    there = new FakeMachine();
    there.answer('artifact.list', ({ projectId }) => ({ artifacts: projectId === 'remote-atlas' ? [SUMMARY] : [] }));
    there.answer('artifact.get', ({ artifactId }) => {
        if (artifactId !== 'art-remote') {
            throw new TransportError('not-found', 'No such artifact');
        }
        return REMOTE_RESULT;
    });
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
    workspace = await openFakeWorkspace(here, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'files' }));
    await page.unmount();
    workspace.close();
    disconnectThere();
    useFiles.setState({ tabs: [] });
    useEndpoints.getState().setActive(LOCAL_ENDPOINT_ID);
    useEndpoints.getState().remove(REMOTE);
    setSystemTime();
});

describe('Output on a linked machine', () => {
    test('All projects shows it, and Copy to this machine copies the version into this project', async () => {
        await act(async () => useUi.getState().setPanel({ open: true, kind: 'output' }));
        await until(() => text().includes('Nothing saved yet'));
        expect(text()).not.toContain('Release notes');
        await clickOn(document.querySelector('button[aria-label="Filters"]'));
        await openSubmenu('Project');
        await clickOn(
            ([...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]).find((item) => item.textContent?.includes('All projects')) ?? null
        );
        while (document.querySelector('[role="menu"]') !== null) {
            const menus = document.querySelectorAll('[role="menu"]');
            await pressKey(menus[menus.length - 1]!, 'Escape');
        }
        await until(() => text().includes('On MacBook Pro') && text().includes('Release notes'));
        expect(there.requests('artifact.list')).toContainEqual({ projectId: 'remote-atlas' });

        await clickOn(([...document.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.includes('Release notes')) ?? null);
        await openMore();
        // What the window cannot write into on the other machine is not offered there.
        expect([...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.textContent?.trim())).toEqual(['Copy to this machine']);
        await clickOn(menuItemNamed('Copy to this machine'));
        await until(() => text().includes('Copied to this machine'));
        expect(here.requests('artifact.importFrom')).toEqual([
            { machineId: REMOTE, artifactId: 'art-remote', versionId: 'ver-remote', projectId: useProject.getState().current!.projectId }
        ]);
        await until(() => barButton('Origin') !== null && text().includes('Copied to this machine'));
        await clickOn(barButton('Origin'));
        await until(() => text().includes('Copied from'));
    });

    test('a right click on its row offers only Open and Copy to this machine', async () => {
        await act(async () => useUi.getState().setPanel({ open: true, kind: 'output' }));
        await until(() => text().includes('Nothing saved yet'));
        await clickOn(document.querySelector('button[aria-label="Filters"]'));
        await openSubmenu('Project');
        await clickOn(
            ([...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]).find((item) => item.textContent?.includes('All projects')) ?? null
        );
        while (document.querySelector('[role="menu"]') !== null) {
            const menus = document.querySelectorAll('[role="menu"]');
            await pressKey(menus[menus.length - 1]!, 'Escape');
        }
        await until(() => text().includes('Release notes'));
        const row = ([...document.querySelectorAll('section button')] as HTMLElement[]).find((button) => button.textContent?.startsWith('Release notes'))!;
        await act(async () => {
            row.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
        });
        await until(() => document.querySelector('[role="menu"]') !== null);
        const items = [...document.querySelectorAll('[role="menu"] [role="menuitem"]')] as HTMLElement[];
        expect(items.map((item) => item.textContent?.trim())).toEqual(['Open', 'Copy to this machine']);
        await clickOn(items[1]!);
        await until(() => text().includes('Copied to this machine'));
        expect(here.requests('artifact.importFrom')).toEqual([
            { machineId: REMOTE, artifactId: 'art-remote', versionId: 'ver-remote', projectId: useProject.getState().current!.projectId }
        ]);
    });

    test('a refusal says what went wrong in plain words', async () => {
        here.answer('artifact.importFrom', () => {
            throw new TransportError('machine-unreachable', 'The other machine did not answer');
        });
        await act(async () => openArtifact('art-remote', 'Release notes', null, REMOTE));
        await openMore();
        await clickOn(menuItemNamed('Copy to this machine'));
        await until(() => text().includes('MacBook Pro is not reachable.'));
        expect(text()).toContain('Not copied');
    });

    test('is not offered for a project this one is not linked to there', async () => {
        links = [];
        await act(async () => openArtifact('art-remote', 'Release notes', null, REMOTE));
        await until(() => barButton('Versions') !== null);
        // Nothing is left to do with it here, so the bar has no actions button at all.
        expect(barButton('More')).toBeNull();
        expect(here.requests('artifact.importFrom')).toHaveLength(0);
    });
});
