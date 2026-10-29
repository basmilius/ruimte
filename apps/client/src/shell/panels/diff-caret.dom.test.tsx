import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { isApplePlatform } from '@/desktop/bridge';
import { useFiles } from '@/state/files';
import { useSettings } from '@/state/settings';
import { FakeMachine } from '../../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../../testing/fake-workspace';
import { menuItem } from '../../../testing/dom-helpers';
import { clickOn, mount, pressKey, until, type Mounted } from '../../../testing/dom';

const CWD = '/work/atlas';
const FILE = `${CWD}/src/cart.ts`;
const OLD = 'head\nkeep\nold\ntail\n';
const NEW = 'head\nkeep\nfresh\ntail\n';
const PATCH = 'diff --git a/src/cart.ts b/src/cart.ts\n--- a/src/cart.ts\n+++ b/src/cart.ts\n@@ -1,4 +1,4 @@\n head\n keep\n-old\n+fresh\n tail\n';
const JUMP = isApplePlatform() ? { metaKey: true } : { ctrlKey: true };
const CANVAS = { kind: 'canvas', id: 'canvas', name: 'Canvas', nodes: [], edges: [], texts: [], groups: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function diffInput(): HTMLTextAreaElement | null {
    return document.querySelector<HTMLTextAreaElement>('.file-diff textarea');
}

/* The old and the new pane of a split diff, in that order. */
function panes(): HTMLTextAreaElement[] {
    return [...document.querySelectorAll<HTMLTextAreaElement>('.file-diff textarea')];
}

async function openMenu(): Promise<void> {
    await clickOn(document.querySelector('button[aria-label="More"]'));
    await until(() => menuItem('Open file') !== null);
}

/* Opens the change as a diff tab and puts the caret `down` lines and `right` characters into it. */
async function caretAt(down: number, right: number): Promise<HTMLTextAreaElement> {
    await act(async () => useFiles.getState().open(FILE, 8, { kind: 'diff', cwd: CWD, scope: 'worktree', staged: false }));
    await until(() => diffInput() !== null);
    const input = diffInput()!;
    await act(async () => input.focus());
    for (let step = 0; step < down; step++) {
        await pressKey(input, 'ArrowDown');
    }
    for (let step = 0; step < right; step++) {
        await pressKey(input, 'ArrowRight');
    }
    return input;
}

function fileRead(): boolean {
    return machine.requests('fs.read').some((payload) => payload.path === FILE);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('git.diff', () => ({ path: 'src/cart.ts', diff: PATCH, added: 1, deleted: 1, binary: false, oldText: OLD, newText: NEW }));
    machine.answer('fs.read', () => ({ kind: 'text', text: NEW, encoding: 'utf-8', size: NEW.length, mtime: 1, language: 'typescript' }) as never);
    workspace = await openFakeWorkspace(machine, { views: [CANVAS] } as never, { activeViewId: CANVAS.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useSettings.getState().update({ diffLayout: 'stacked' }));
    await page.unmount();
    workspace.close();
});

describe('a diff opens its file at the line of the caret', () => {
    test('Jump to Source on an added line opens the file there, at the same column', async () => {
        const input = await caretAt(3, 2);

        expect(fileRead()).toBe(false);

        await pressKey(input, 'ArrowDown', JUMP);
        await until(fileRead);
        await until(() => document.body.textContent?.includes('Ln 3, Col 3') === true);
        // The keyboard is in the file's editor, so the line can be edited at once.
        await until(() => document.activeElement instanceof HTMLTextAreaElement && document.activeElement.closest('.file-diff') === null);
    });

    test('a removed line opens on the line that took its place', async () => {
        const input = await caretAt(2, 1);
        await pressKey(input, 'ArrowDown', JUMP);
        await until(fileRead);
        await until(() => document.body.textContent?.includes('Ln 3, Col 1') === true);
    });

    test('the menu of the diff says the line of the caret and opens the file at it', async () => {
        await caretAt(1, 0);
        await clickOn(document.querySelector('button[aria-label="More"]'));
        await until(() => menuItem('Open file at line 2') !== null);
        await clickOn(menuItem('Open file at line 2'));
        await until(fileRead);
        await until(() => document.body.textContent?.includes('Ln 2, Col 1') === true);
    });

    test('a diff that only got the keyboard already knows its line', async () => {
        await caretAt(0, 0);
        await openMenu();

        expect(menuItem('Open file at line 1')).not.toBeNull();
    });

    test('in a split diff the pane with the keyboard decides the line, also when its caret never moved', async () => {
        await act(async () => useSettings.getState().update({ diffLayout: 'split' }));
        await caretAt(0, 0);
        await until(() => panes().length === 2);
        const [old, fresh] = panes();
        await act(async () => fresh!.focus());
        await pressKey(fresh!, 'ArrowDown');
        await pressKey(fresh!, 'ArrowDown');
        await openMenu();

        expect(menuItem('Open file at line 3')).not.toBeNull();

        await pressKey(document.activeElement ?? document.body, 'Escape');
        await act(async () => old!.focus());
        await openMenu();

        expect(menuItem('Open file at line 1')).not.toBeNull();
    });
});
