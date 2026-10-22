import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';

/*
 * The tree of a commit draws its rows in a shadow root, and happy-dom hands React no event from inside
 * one, so a right click on a file of a diff is driven here through the conflict list, which offers the
 * same menu without a tree.
 */

const CWD = '/work/atlas';
const CANVAS = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], edges: [], texts: [], groups: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function entry(path: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[data-conflict-path="${path}"]`);
}

function menuItem(text: string): HTMLElement | null {
    return ([...document.querySelectorAll('[role="menuitem"]')] as HTMLElement[]).find((item) => item.textContent?.trim().startsWith(text)) ?? null;
}

async function rightClick(element: HTMLElement | null): Promise<void> {
    expect(element).not.toBeNull();
    await act(async () => {
        element!.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 40, clientY: 40, button: 2 }));
    });
    await until(() => menuItem('Open changes') !== null);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('git.conflicts', () => ({
        operation: 'merge' as const,
        ours: 'main',
        theirs: 'feature',
        files: [
            { path: 'src/a.ts', kind: 'text' as const },
            { path: 'src/b.ts', kind: 'text' as const }
        ]
    }));
    workspace = await openFakeWorkspace(machine, { views: [CANVAS] } as never, { activeViewId: CANVAS.id, views: {} });
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setConflicts({ cwd: CWD }));
    await until(() => entry('src/b.ts') !== null);
});

afterEach(async () => {
    await act(async () => useUi.getState().setConflicts(null));
    await page.unmount();
    workspace.close();
});

describe('a file in a list that is read and not staged', () => {
    test('offers what a file is asked, and nothing that stages or discards', async () => {
        await rightClick(entry('src/b.ts'));
        expect(menuItem('Open file')).not.toBeNull();
        expect(menuItem('Reveal in Files')).not.toBeNull();
        expect(menuItem('Stage')).toBeNull();
        expect(menuItem('Discard')).toBeNull();
        expect(menuItem('Copy commit hash')).toBeNull();
    });

    test('"Open changes" brings that file up', async () => {
        await until(() => entry('src/a.ts')!.className.includes('bg-surface-active'));
        await rightClick(entry('src/b.ts'));
        await clickOn(menuItem('Open changes'));
        await until(() => entry('src/b.ts')!.className.includes('bg-surface-active'));
        expect(entry('src/a.ts')!.className.includes('bg-surface-active')).toBe(false);
    });

    test('"Open file" reads the file of the checkout', async () => {
        machine.answer('fs.read', () => ({ kind: 'text', text: 'export {};\n', encoding: 'utf-8', size: 11, mtime: 1, language: 'typescript' }) as never);
        await rightClick(entry('src/b.ts'));
        await clickOn(menuItem('Open file'));
        await until(() => machine.requests('fs.read').some((payload) => payload.path === `${CWD}/src/b.ts`));
    });
});
