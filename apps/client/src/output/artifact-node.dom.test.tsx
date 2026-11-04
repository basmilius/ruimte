import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import type { ArtifactGetResult, ArtifactVersion, ProjectCanvasView, ProjectNode } from '@ruimte/contracts';
import { act } from 'react';
import { useFiles } from '@/state/files';
import { windowWorkspace } from '@/state/window';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const REPORTS: Record<string, string> = { 'ver-2': '# Morning\n\nAll green\n', 'ver-1': '# Morning\n\nTwo red\n' };

function version(versionId: string, number: number): ArtifactVersion {
    const body = REPORTS[versionId]!;
    return {
        versionId,
        number,
        createdAt: Date.UTC(2026, 9, 20 + number, 7),
        files: [{ name: 'morning.md', mime: 'text/markdown', size: body.length, sha256: versionId }],
        bytes: body.length,
        provenance: { maker: 'agent', machineId: 'mac' },
        copiedTo: []
    };
}

const MORNING: ArtifactGetResult = {
    artifact: { artifactId: 'art-1', projectId: 'project-atlas', projectName: 'Atlas', title: 'Morning summary', kind: 'report', createdAt: 0 },
    versions: [version('ver-2', 2), version('ver-1', 1)],
    chatPresent: false
};

function artifactNode(id: string, artifact?: ProjectNode['artifact']): ProjectNode {
    return { id, kind: 'artifact', title: 'Morning summary', x: 0, y: 0, w: 440, h: 520, ...(artifact === undefined ? {} : { artifact }) };
}

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

async function open(node: ProjectNode): Promise<HTMLElement> {
    const main: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [node], texts: [], edges: [], layouts: [] };
    workspace = await openFakeWorkspace(machine, { views: [main] }, { activeViewId: main.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-node-id="${node.id}"]`) !== null);
    return page.host.querySelector<HTMLElement>(`[data-node-id="${node.id}"]`)!;
}

function button(frame: HTMLElement, label: string): HTMLElement | null {
    return ([...frame.querySelectorAll('button')] as HTMLElement[]).find((element) => element.textContent?.trim() === label) ?? null;
}

function versionItems(): HTMLElement[] {
    return [...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[];
}

function savedArtifact(): unknown {
    const view = machine
        .requests('project.save')
        .at(-1)
        ?.content.views.find((candidate) => candidate.id === 'main');
    return view?.kind === 'canvas' ? view.nodes[0]?.artifact : undefined;
}

beforeEach(() => {
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('artifact.get', () => MORNING);
    machine.answer('bytes.read', ({ resource, offset }) => {
        const body = resource.kind === 'artifact' ? (REPORTS[resource.versionId] ?? '') : '';
        return { mime: 'text/markdown', size: body.length, version: 'v', offset, data: btoa(body.slice(offset)) };
    });
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
    useFiles.setState({ tabs: [] });
});

describe('an artifact node', () => {
    test('follows the latest version, stays on any version picked and follows again', async () => {
        const frame = await open(artifactNode('out', { id: 'art-1' }));
        await until(() => (frame.textContent ?? '').includes('All green'));
        expect(frame.textContent).toContain('Version 2,');
        expect(machine.requests('bytes.read')[0]!.resource).toEqual({ kind: 'artifact', artifactId: 'art-1', versionId: 'ver-2', file: 0 });

        await clickOn(button(frame, 'Latest'));
        await until(() => versionItems().length > 0);
        // Every version is offered, newest first, each with its number beside the time it was saved.
        expect(versionItems().map((item) => item.textContent?.split(',')[0])).toEqual(['Follow the latest', 'Version 2', 'Version 1']);
        await clickOn(versionItems().find((item) => item.textContent?.startsWith('Version 1,')) ?? null);
        await until(() => versionItems().length === 0 && button(frame, 'v1') !== null && (frame.textContent ?? '').includes('Two red'));
        await act(async () => windowWorkspace()!.connection.projects.flush());
        await until(() => machine.requests('project.save').length > 0);
        expect(savedArtifact()).toEqual({ id: 'art-1', version: 'ver-1' });

        await clickOn(button(frame, 'v1'));
        await until(() => versionItems().length > 0);
        await clickOn(versionItems().find((item) => item.textContent === 'Follow the latest') ?? null);
        await until(() => button(frame, 'Latest') !== null && (frame.textContent ?? '').includes('All green'));
    });

    test('pinned to an older version, says a newer one exists and shows it on request', async () => {
        const frame = await open(artifactNode('out', { id: 'art-1', version: 'ver-1' }));
        await until(() => (frame.textContent ?? '').includes('Two red'));
        expect(button(frame, 'v1')).not.toBeNull();
        expect(frame.textContent).toContain('Version 2 is newer');

        await clickOn(button(frame, 'Show'));
        await until(() => (frame.textContent ?? '').includes('All green'));
        expect(button(frame, 'v2')).not.toBeNull();
    });

    test('without a reference of this machine says it is not here and asks nothing', async () => {
        const frame = await open(artifactNode('out'));
        await until(() => (frame.textContent ?? '').includes('Not on this machine'));
        expect(machine.requests('artifact.get')).toHaveLength(0);
    });

    test('a version a cleanup took says it was removed', async () => {
        const frame = await open(artifactNode('out', { id: 'art-1', version: 'ver-0' }));
        await until(() => (frame.textContent ?? '').includes('Removed'));
    });
});
