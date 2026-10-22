import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { ArchiveListResult } from '@ruimte/contracts';
import { useFiles } from '@/state/files';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';

const ARCHIVE = '/work/atlas/site.zip';
const CANVAS = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], edges: [], texts: [], groups: [] };
const README = '# Read me\n';

const LISTING: ArchiveListResult = {
    format: 'zip',
    entries: [
        { path: 'docs', kind: 'directory', size: 0, readable: true },
        { path: 'docs/readme.md', kind: 'file', size: README.length, compressedSize: 9, readable: true }
    ],
    truncated: false,
    unsafe: 0
};

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

/* The tree draws its rows in a shadow root of its own. */
function row(path: string): HTMLElement | null {
    const host = page.host.querySelector('.adecore-file-tree-host');
    const root = host?.shadowRoot ?? null;
    return (root ?? host)?.querySelector<HTMLElement>(`[data-item-path="${path}"]`) ?? null;
}

function button(label: string): HTMLElement | null {
    return (
        ([...document.querySelectorAll('button')] as HTMLElement[]).find(
            (element) => element.getAttribute('aria-label') === label || element.textContent?.trim() === label
        ) ?? null
    );
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'binary' as const, mime: 'application/zip', size: 120, mtime: 7 }));
    machine.answer('archive.list', () => LISTING);
    machine.answer('bytes.read', (payload) => ({
        mime: 'text/plain; charset=utf-8',
        size: README.length,
        version: '7-120',
        offset: payload.offset,
        data: Buffer.from(README.slice(payload.offset, payload.offset + payload.length)).toString('base64'),
        language: 'markdown'
    }));
    machine.answer('fs.list', () => ({ path: '/work/atlas', entries: [], truncated: false }));
    machine.answer('archive.extract', (payload) => ({ to: payload.to, files: 1, directories: 1, bytes: README.length, skipped: [], skippedTotal: 0 }));
    workspace = await openFakeWorkspace(machine, { views: [CANVAS] } as never, { activeViewId: CANVAS.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useFiles.getState().open(ARCHIVE, 10));
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('an archive opened as a file', () => {
    test('lists what it holds, with the format and the totals under it', async () => {
        await until(() => machine.requests('archive.list').length > 0);
        expect(machine.requests('archive.list')).toEqual([{ path: ARCHIVE }]);
        await until(() => page.host.textContent?.includes('Pick a file to preview.') === true);
        expect(page.host.textContent).toContain('ZIP');
        expect(page.host.textContent).toContain('1 file');
    });

    test('previews the entry that is picked, read through bytes.read', async () => {
        await until(() => row('docs/readme.md') !== null);
        await clickOn(row('docs/readme.md'));
        await until(() => machine.requests('bytes.read').length > 0);
        expect(machine.requests('bytes.read')[0]!.resource).toEqual({ kind: 'file', path: ARCHIVE, entry: 'docs/readme.md' });
        await until(() => page.host.textContent?.includes('# Read me') === true);
    });

    test('"Extract all" asks for the folder and extracts into it', async () => {
        await until(() => page.host.textContent?.includes('Pick a file to preview.') === true);
        await clickOn(button('Extract all'));
        await until(() => button('Extract') !== null);
        await until(() => machine.requests('fs.list').length > 0);
        await clickOn(button('Extract'));
        await until(() => machine.requests('archive.extract').length > 0);
        expect(machine.requests('archive.extract')).toEqual([{ path: ARCHIVE, to: '/work/atlas/site', projectId: 'project-atlas' }]);
    });

    test('a machine that does not list archives shows the archive as a file it cannot draw', async () => {
        await page.unmount();
        machine.answersOnly(['fs.read', 'project.open', 'project.list']);
        const listed = machine.requests('archive.list').length;
        page = mount();
        await page.renderApp();
        await until(() => page.host.textContent?.includes('cannot be shown here') === true);
        expect(machine.requests('archive.list')).toHaveLength(listed);
    });
});
