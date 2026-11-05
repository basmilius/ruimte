import { afterEach, beforeEach, describe, expect, setSystemTime, test } from 'bun:test';
import { useProvidersStore } from '@adecore/agents-react/state';
import { REQUEST_SCHEMAS, type ArtifactFile, type ArtifactGetResult, type ArtifactSummary, type ArtifactVersion, type RequestType } from '@ruimte/contracts';
import { act } from 'react';
import { visibleRect } from '@/canvas-model/math';
import { liveCanvas } from '@/state/canvas';
import { artifactTabKey, useFiles } from '@/state/files';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { TransportError } from '@/transport-api/transport';
import { clickOn, mount, openSubmenu, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();
// The panel groups by the day it is now, so the clock stands still on a known one.
const NOW = new Date(2026, 9, 25, 12, 0).getTime();
const DAY = 24 * 60 * 60 * 1000;
const REPORTS: Record<string, string> = {
    'v-new': '# Dependency report\n\n9 behind\n',
    'v-old': '# Dependency report\n\n8 behind\n'
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function version(versionId: string, number: number, createdAt: number, patch: Partial<ArtifactVersion> = {}): ArtifactVersion {
    return {
        versionId,
        number,
        createdAt,
        files: [{ name: 'dependency-report.md', mime: 'text/markdown', size: REPORTS[versionId]?.length ?? 10, sha256: versionId }],
        bytes: REPORTS[versionId]?.length ?? 10,
        provenance: { maker: 'agent', machineId: 'mac', chatId: 'chat-gone' },
        copiedTo: [],
        ...patch
    };
}

function summary(artifactId: string, title: string, patch: Partial<ArtifactSummary> = {}): ArtifactSummary {
    const latest = patch.latest ?? version(`${artifactId}-v1`, 1, NOW);
    return {
        artifactId,
        projectId: 'project-atlas',
        projectName: 'Atlas',
        title,
        kind: 'report',
        createdAt: latest.createdAt,
        latest,
        versionCount: 1,
        totalBytes: latest.bytes,
        ...patch
    };
}

const DEPENDENCIES: ArtifactGetResult = {
    artifact: { artifactId: 'deps', projectId: 'project-atlas', projectName: 'Atlas', title: 'Dependency report', kind: 'report', createdAt: NOW - 7 * DAY },
    versions: [version('v-new', 2, NOW), version('v-old', 1, NOW - 7 * DAY)],
    chatPresent: false
};

const LIST: ArtifactSummary[] = [
    summary('deps', 'Dependency report', { latest: DEPENDENCIES.versions[0]!, versionCount: 2 }),
    summary('shots', 'Nightly screenshots', { kind: 'image', latest: version('shots-v1', 1, NOW - 3 * DAY) }),
    summary('beacon', 'Beacon build', { projectId: 'project-beacon', projectName: 'Beacon', kind: 'build', latest: version('beacon-v1', 1, NOW - 20 * DAY) })
];

function text(): string {
    return page.host.textContent ?? '';
}

function infoRow(label: string): string | undefined {
    const term = ([...document.querySelectorAll('dt')] as HTMLElement[]).find((entry) => entry.textContent === label);
    return term?.nextElementSibling?.textContent ?? undefined;
}

/* A control of the artifact view's bar, named by its label. */
function barButton(label: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`button[aria-label="${label}"]`);
}

/* The pair a diff runs between, as a screen reader names it. */
function compareRange(): string | null {
    return page.host.querySelector('[role="group"][aria-label^="From v"]')?.getAttribute('aria-label') ?? null;
}

async function openOrigin(): Promise<void> {
    await clickOn(barButton('Origin'));
    await until(() => infoRow('Made by') !== undefined);
}

async function openVersions(): Promise<void> {
    await clickOn(barButton('Versions'));
    await until(() => document.querySelectorAll('[role="menu"] [role="menuitemradio"]').length > 0);
}

/* The rows of the menu that is open, as they read. */
function radioRows(): string[] {
    return [...document.querySelectorAll('[role="menu"] [role="menuitemradio"]')].map((row) => row.textContent ?? '');
}

async function pickVersion(start: string): Promise<void> {
    await openVersions();
    await clickOn(([...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]).find((row) => row.textContent?.startsWith(start)) ?? null);
}

async function openMore(): Promise<void> {
    await clickOn(barButton('More'));
    await until(() => document.querySelector('[role="menu"]') !== null);
}

function buttonWithText(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === label) ?? null;
}

function menuItem(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]).find((item) => item.textContent?.includes(label)) ?? null;
}

async function openFilters(): Promise<void> {
    await clickOn(document.querySelector('button[aria-label="Filters"]'));
    await until(() => document.querySelector('[role="menu"]') !== null);
}

/* Every filter sits behind the one button in the panel's header, a submenu per filter. */
async function filterBy(title: string, choice: string): Promise<void> {
    await openFilters();
    await openSubmenu(title);
    await clickOn(menuItem(choice));
    // A pick leaves the menu open for the next filter, so Escape closes it, a submenu at a time.
    while (document.querySelector('[role="menu"]') !== null) {
        const menus = document.querySelectorAll('[role="menu"]');
        await pressKey(menus[menus.length - 1]!, 'Escape');
    }
}

/* What a right click does: the menu opens at the pointer. */
async function rightClick(target: Element | null | undefined): Promise<void> {
    expect(target ?? null).not.toBeNull();
    await act(async () => {
        target!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 10, clientY: 10, button: 2 }));
    });
    await until(() => document.querySelector('[role="menu"]') !== null);
}

function menuItems(): string[] {
    return [...document.querySelectorAll('[role="menu"] [role="menuitem"]')].map((item) => item.textContent?.trim() ?? '');
}

function menuItemNamed(label: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim() === label) ?? null;
}

function panelRow(title: string): HTMLElement | undefined {
    return ([...page.host.querySelectorAll('section button')] as HTMLElement[]).find((button) => button.textContent?.startsWith(title));
}

/* The confirm of the question that is open. */
async function confirmDialog(label: string): Promise<void> {
    await until(() => document.querySelector('[role="dialog"]') !== null);
    const dialog = document.querySelector('[role="dialog"]')!;
    await clickOn(([...dialog.querySelectorAll('button')] as HTMLElement[]).find((button) => button.textContent?.trim() === label) ?? null);
}

async function openPanel(): Promise<void> {
    await act(async () => useUi.getState().setPanel({ open: true, kind: 'output' }));
}

beforeEach(async () => {
    setSystemTime(NOW);
    localStorage.clear();
    machine = new FakeMachine();
    machine.answer('artifact.list', () => ({ artifacts: LIST }));
    machine.answer('artifact.get', ({ artifactId }) => {
        if (artifactId !== 'deps') {
            throw new TransportError('not-found', 'No such artifact');
        }
        return DEPENDENCIES;
    });
    machine.answer('bytes.read', ({ resource, offset }) => {
        const body = resource.kind === 'artifact' ? (REPORTS[resource.versionId] ?? '') : '';
        return { mime: 'text/markdown', size: body.length, version: 'v', offset, data: btoa(body.slice(offset)) };
    });
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setPanel({ open: false, kind: 'files' }));
    await page.unmount();
    workspace.close();
    useFiles.setState({ tabs: [] });
    setSystemTime();
});

describe('the Output panel', () => {
    test('lists this project by date, and All projects adds the others', async () => {
        await openPanel();
        await until(() => text().includes('Dependency report'));
        expect(machine.requests('artifact.watch')).toHaveLength(1);
        expect(text()).toContain('Today');
        expect(text()).toContain('This week');
        expect(text()).toContain('Nightly screenshots');
        expect(text()).not.toContain('Beacon build');
        expect(text()).toContain('2 shown');

        // Where the panel starts says nothing about filters.
        expect(buttonWithText('Reset')).toBeNull();
        await openFilters();
        await openSubmenu('Project');
        // This project or all of them; another single project is never a choice.
        expect([...document.querySelectorAll('[role="menuitemradio"]')].map((item) => item.textContent?.trim())).toEqual(['This project', 'All projects']);
        while (document.querySelector('[role="menu"]') !== null) {
            const menus = document.querySelectorAll('[role="menu"]');
            await pressKey(menus[menus.length - 1]!, 'Escape');
        }
        await filterBy('Project', 'All projects');
        await until(() => text().includes('Beacon build'));
        expect(text()).toContain('All projects');
        expect(text()).toContain('Earlier');
        expect(text()).toContain('3 shown');
        await clickOn(buttonWithText('Reset'));
        await until(() => !text().includes('Beacon build'));
        expect(buttonWithText('Reset')).toBeNull();
    });

    test('a kind narrows the list, and a filter nothing passes says so', async () => {
        await openPanel();
        await until(() => text().includes('Nightly screenshots'));
        await filterBy('Kind', 'Image');
        await until(() => !text().includes('Dependency report'));
        expect(text()).toContain('Nightly screenshots');
        expect(text()).toContain('1 filter');

        await filterBy('Size', 'Over 1 GB');
        await until(() => text().includes('Nothing matches these filters.'));
        await openFilters();
        await clickOn(([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim() === 'Reset') ?? null);
        await until(() => text().includes('Dependency report'));
    });

    test('a row is one artifact and asks nothing more of the machine', async () => {
        await openPanel();
        await until(() => text().includes('Dependency report'));
        expect(text()).toContain('2 versions');
        // A chat can be removed, so a row names neither it nor who saved.
        expect(text()).not.toContain('2 versions,');
        expect(machine.requests('artifact.get')).toHaveLength(0);
    });

    test('a right click on a row offers what the view does with its latest version', async () => {
        await openPanel();
        await until(() => text().includes('Dependency report'));
        await rightClick(panelRow('Dependency report'));
        expect(menuItems()).toEqual(['Open', 'Copy to project…', 'Pin to canvas', 'Add to sidebar', 'Remove…']);

        await clickOn(menuItemNamed('Remove…'));
        await until(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes('Remove Dependency report?'));
        expect(document.querySelector('[role="dialog"]')!.textContent).toContain('2 versions');
        machine.answer('artifact.remove', () => ({ removed: 2, freedBytes: 50 }));
        await confirmDialog('Remove');
        await until(() => machine.requests('artifact.remove').length === 1);
        expect(machine.requests('artifact.remove')[0]).toEqual({ artifactId: 'deps' });
        await until(() => text().includes('50 B freed'));
    });

    test('a machine with nothing saved says how something gets there', async () => {
        machine.answer('artifact.list', () => ({ artifacts: [] }));
        await openPanel();
        await until(() => text().includes('Nothing saved yet'));
    });

    test('a machine that does not keep Output asks for an update and is never asked', async () => {
        const all = Object.keys(REQUEST_SCHEMAS) as RequestType[];
        machine.answersOnly(all.filter((type) => !type.startsWith('artifact.')));
        await openPanel();
        await until(() => text().includes('Update this machine to use Output.'));
        expect(machine.requests('artifact.list')).toHaveLength(0);
        expect(machine.requests('artifact.watch')).toHaveLength(0);
    });
});

describe('the artifact view', () => {
    async function openDependencies(): Promise<void> {
        await openPanel();
        await until(() => text().includes('Dependency report'));
        await clickOn(
            ([...page.host.querySelectorAll('section button')] as HTMLElement[]).find((button) => button.textContent?.startsWith('Dependency report')) ?? null
        );
        await until(() => barButton('Versions') !== null && text().includes('9 behind'));
    }

    test('shows the latest version across the bar, and its record behind Origin with a chat that is gone', async () => {
        await openDependencies();
        expect(barButton('Versions')!.textContent).toStartWith('v2, ');
        expect(barButton('Versions')!.textContent).toContain('Latest');
        expect(infoRow('Made by')).toBeUndefined();
        await openOrigin();
        // A version saved before the machine noted the CLI and the model says only that an agent made it.
        expect(infoRow('Made by')).toBe('Agent');
        expect(document.body.textContent).toContain('Chat removed');
        expect(document.body.textContent).toContain('Agents cannot change it.');
        expect(machine.requests('bytes.read')[0]!.resource).toEqual({ kind: 'artifact', artifactId: 'deps', versionId: 'v-new', file: 0 });
    });

    test('names the model an agent ran as the machine names it, beside the mark of its CLI', async () => {
        const latest = version('v-new', 2, NOW, {
            provenance: { maker: 'agent', machineId: 'mac', chatId: 'chat-gone', agent: 'claude', model: 'claude-opus-5-5' }
        });
        machine.answer('artifact.get', () => ({ ...DEPENDENCIES, versions: [latest, DEPENDENCIES.versions[1]!] }));
        act(() =>
            useProvidersStore
                .getState()
                .setProviders(useProject.getState().currentEndpointId ?? '', [
                    { kind: 'claude', name: 'Claude Code', models: [{ slug: 'claude-opus-5-5', name: 'Claude Opus 5.5' }] } as never
                ])
        );
        await openDependencies();
        await openOrigin();
        expect(infoRow('Made by')).toBe('Claude Opus 5.5');
        expect(document.querySelector('dd svg')).not.toBeNull();
    });

    test('Compare sets the version before it beside the latest, and Compare with picks another', async () => {
        REPORTS['v-first'] = '# Dependency report\n\n7 behind\n';
        const three = [version('v-new', 3, NOW), version('v-old', 2, NOW - 7 * DAY), version('v-first', 1, NOW - 14 * DAY)];
        machine.answer('artifact.get', () => ({ ...DEPENDENCIES, versions: three }));
        await openDependencies();
        await clickOn(barButton('Compare'));
        await until(() => barButton('Compare with')?.textContent === 'Compare with v2');
        await until(() => compareRange() === 'From v2 to v3');
        expect(text()).toContain('+1');
        expect(text()).toContain('-1');

        await clickOn(barButton('Compare with'));
        await until(() => radioRows().length === 2);
        expect(radioRows().map((row) => row.slice(0, 3))).toEqual(['v2,', 'v1,']);
        await clickOn(([...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]).find((row) => row.textContent?.startsWith('v1, ')) ?? null);
        await until(() => barButton('Compare with')?.textContent === 'Compare with v1');
        await until(() => compareRange() === 'From v1 to v3');
        delete REPORTS['v-first'];
    });

    test('Compare reads from the older version to the newer, also when the one on screen is the older', async () => {
        REPORTS['v-more'] = '# Dependency report\n\n9 behind\n2 major\n';
        machine.answer('artifact.get', () => ({ ...DEPENDENCIES, versions: [version('v-more', 3, NOW), version('v-new', 2, NOW - DAY)] }));
        await openDependencies();
        await pickVersion('v2, ');
        await clickOn(barButton('Compare'));
        await until(() => barButton('Compare with')?.textContent === 'Compare with v3');
        await until(() => compareRange() === 'From v2 to v3');
        const range = document.querySelector('[role="group"][aria-label="From v2 to v3"]')!;
        expect(range.textContent).toBe('v2v3');
        expect(range.querySelector('svg')).not.toBeNull();
        // v3 added a line to v2, so that is what the counts say.
        expect(text()).toContain('+1');
        expect(text()).toContain('-0');
        delete REPORTS['v-more'];
    });

    test('names every version by its number in the versions menu, and a pick shows it', async () => {
        await openDependencies();
        await openVersions();
        const rows = radioRows();
        expect(rows[0]).toStartWith('v2, ');
        expect(rows[0]).toContain('Latest');
        expect(rows[1]).toStartWith('v1, ');
        await clickOn(([...document.querySelectorAll('[role="menuitemradio"]')] as HTMLElement[]).find((row) => row.textContent?.startsWith('v1, ')) ?? null);
        await until(() => text().includes('8 behind'));
        expect(barButton('Versions')!.textContent).toStartWith('v1, ');
    });

    test('Pin to canvas stays on the version picked, in view of that canvas', async () => {
        await openDependencies();
        await pickVersion('v1, ');
        await until(() => text().includes('8 behind'));
        await openMore();
        await openSubmenu('Pin to canvas');
        await clickOn(([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim() === 'Main') ?? null);
        await until(() => liveCanvas('main') !== null);
        // The page has no layout to measure, so the canvas gets the size a window would give it, after the camera it opened on.
        await act(async () => {
            liveCanvas('main')!.setCamera({ x: -2000, y: -1000, zoom: 1 });
            liveCanvas('main')!.setViewport({ w: 1280, h: 800 });
        });
        await until(() => Object.values(liveCanvas('main')!.nodes).some((node) => node.kind === 'artifact'));
        const node = Object.values(liveCanvas('main')!.nodes).find((candidate) => candidate.kind === 'artifact')!;
        expect(node.artifact).toEqual({ id: 'deps', version: 'v-old' });
        const seen = visibleRect({ x: -2000, y: -1000, zoom: 1 }, { w: 1280, h: 800 });
        expect(node.x).toBeGreaterThanOrEqual(seen.x);
        expect(node.y).toBeGreaterThanOrEqual(seen.y);
        expect(node.x + node.w).toBeLessThanOrEqual(seen.x + seen.w);
        expect(node.y + node.h).toBeLessThanOrEqual(seen.y + seen.h);
    });

    test('Remove takes the artifact whole and closes its view', async () => {
        machine.answer('artifact.remove', () => ({ removed: 2, freedBytes: 50 }));
        await openDependencies();
        expect(useFiles.getState().tabs.some((tab) => tab.key === artifactTabKey('deps'))).toBe(true);
        await openMore();
        await clickOn(menuItemNamed('Remove…'));
        await confirmDialog('Remove');
        await until(() => machine.requests('artifact.remove').length === 1);
        expect(machine.requests('artifact.remove')[0]).toEqual({ artifactId: 'deps' });
        await until(() => !useFiles.getState().tabs.some((tab) => tab.key === artifactTabKey('deps')));
    });

    test('a version in the versions menu removes only that version', async () => {
        machine.answer('artifact.remove', () => ({ removed: 1, freedBytes: 10 }));
        await openDependencies();
        await openVersions();
        const row = ([...document.querySelectorAll('[role="menu"] [role="group"]')] as HTMLElement[]).find((group) =>
            group.getAttribute('aria-label')?.startsWith('v1, ')
        )!;
        await clickOn(row.querySelectorAll('[role="menuitem"]')[0] ?? null);
        await until(() => (document.querySelector('[role="dialog"]')?.textContent ?? '').includes('Remove version 1?'));
        await confirmDialog('Remove');
        await until(() => machine.requests('artifact.remove').length === 1);
        expect(machine.requests('artifact.remove')[0]).toEqual({ artifactId: 'deps', versionIds: ['v-old'] });
        expect(useFiles.getState().tabs.some((tab) => tab.key === artifactTabKey('deps'))).toBe(true);
    });

    test('a machine that cannot remove offers no Remove', async () => {
        const all = Object.keys(REQUEST_SCHEMAS) as RequestType[];
        machine.answersOnly(all.filter((type) => type !== 'artifact.remove'));
        await openDependencies();
        await openMore();
        expect(menuItems()).toEqual(['Copy to project…', 'Pin to canvas']);
    });

    test('Copy to project shows the folders of the project in a tree of its own height', async () => {
        machine.answer('fs.list', ({ path }) => ({
            path,
            entries:
                path === '/work/atlas'
                    ? [{ name: 'docs', path: '/work/atlas/docs', kind: 'directory' as const, size: null, mtime: 0, hidden: false, ignored: false }]
                    : [],
            truncated: false
        }));
        await openDependencies();
        await openMore();
        await clickOn(menuItemNamed('Copy to project…'));
        await until(() => document.querySelector('[role="dialog"] .adecore-file-tree') !== null);
        const tree = document.querySelector<HTMLElement>('[role="dialog"] .adecore-file-tree')!;
        // A tree only draws the rows its own height holds; under a parent that only caps it, it had none.
        expect(tree.className).toContain('h-56');
        const host = tree.querySelector('.adecore-file-tree-host');
        await until(() => ((host?.shadowRoot ?? host)?.querySelector('[data-item-path="atlas/"]') ?? null) !== null);
        expect(machine.requests('fs.list')[0]).toEqual({ path: '/work/atlas', depth: 1, hidden: true });
    });

    test('Copy to project refuses a name that is taken, beside the name', async () => {
        machine.answer('artifact.copyToProject', () => {
            throw new TransportError('exists', 'That name exists in the project already. Ruimte never overwrites a file.');
        });
        await openDependencies();
        await openMore();
        await clickOn(menuItemNamed('Copy to project…'));
        await until(() => document.querySelector('[role="dialog"]') !== null);
        const dialog = document.querySelector('[role="dialog"]')!;
        await act(async () => {
            dialog.querySelector('form')!.requestSubmit();
        });
        await until(() => (dialog.textContent ?? '').includes('dependency-report.md already exists.'));
        expect(machine.requests('artifact.copyToProject')[0]).toEqual({
            artifactId: 'deps',
            versionId: 'v-new',
            projectId: 'project-atlas',
            path: 'dependency-report.md'
        });
    });
});

describe('a version drawn by what its files are', () => {
    async function openWith(kind: string, files: ArtifactFile[], bodies: Record<number, string>): Promise<void> {
        machine.answer('artifact.get', () => ({
            ...DEPENDENCIES,
            artifact: { ...DEPENDENCIES.artifact, kind },
            versions: [version('v-new', 2, NOW, { files })]
        }));
        machine.answer('bytes.read', ({ resource, offset }) => {
            const body = resource.kind === 'artifact' ? (bodies[resource.file] ?? '') : '';
            return { mime: 'text/plain', size: body.length, version: 'v', offset, data: btoa(body.slice(offset)) };
        });
        await openPanel();
        await until(() => text().includes('Dependency report'));
        await clickOn(panelRow('Dependency report') ?? null);
        await until(() => barButton('Versions') !== null);
    }

    test('an HTML file of a report draws in the sandboxed frame of an agent page, not as a file without a preview', async () => {
        // happy-dom lays nothing out, and the frame opens only once its box has a width.
        const width = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'clientWidth');
        Object.defineProperty(HTMLElement.prototype, 'clientWidth', { configurable: true, get: () => 800 });
        // The sandbox host page is served by Vite or the shell, neither of which runs here.
        const settings = (window as unknown as { happyDOM: { settings: { disableIframePageLoading: boolean } } }).happyDOM.settings;
        settings.disableIframePageLoading = true;
        try {
            const html = '<h1>Rapport</h1>';
            await openWith('report', [{ name: 'rapport.html', mime: 'text/html', size: html.length, sha256: 'h' }], { 0: html });
            await until(() => page.host.querySelector('iframe[title="Dependency report"]') !== null);
            expect(page.host.querySelector('iframe[title="Dependency report"]')!.getAttribute('sandbox')).toBe('allow-scripts allow-forms');
            expect(text()).not.toContain('No preview.');
        } finally {
            settings.disableIframePageLoading = false;
            Object.defineProperty(HTMLElement.prototype, 'clientWidth', width!);
        }
    });

    test('a text file of a build reads as code, and a file without a preview is a pick away', async () => {
        const log = 'compiled 42 modules\n';
        await openWith(
            'build',
            [
                { name: 'app.zip', mime: 'application/zip', size: 2048, sha256: 'z' },
                { name: 'build.log', mime: 'text/plain', size: log.length, sha256: 'l' }
            ],
            { 1: log }
        );
        await until(() => page.host.querySelector('.file-code')?.textContent?.includes('compiled 42 modules') === true);
        expect(buttonWithText('build.log')!.getAttribute('aria-pressed')).toBe('true');
        expect(machine.requests('bytes.read')[0]!.resource).toEqual({ kind: 'artifact', artifactId: 'deps', versionId: 'v-new', file: 1 });

        await clickOn(buttonWithText('app.zip'));
        await until(() => text().includes('No preview.'));
        expect(page.host.querySelector('.file-code')).toBeNull();
    });
});
