import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useDocument } from '@/state/document';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const LEFT = { kind: 'file', id: 'left-view', name: 'left.ts', path: 'src/left.ts' };
const RIGHT = { kind: 'file', id: 'right-view', name: 'right.ts', path: 'src/right.ts' };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function indicator(): HTMLElement | null {
    return document.querySelector('[data-maximized-indicator]');
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('fs.read', () => ({ kind: 'text', text: 'const answer = 42;\n', encoding: 'utf-8', size: 19, mtime: 1, language: 'typescript' }) as never);
    workspace = await openFakeWorkspace(machine, { views: [LEFT, RIGHT] } as never, { activeViewId: LEFT.id, views: {} });
    page = mount();
    await page.renderApp();
    await until(() => page.host.querySelector(`[data-split-cell][data-view-id="${LEFT.id}"]`) !== null);
    await act(async () => useDocument.getState().splitFocused('right', RIGHT.id));
    await until(() => page.host.querySelectorAll('[data-split-cell]').length === 2);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('a maximized cell', () => {
    test('says how many cells it hides in its own bar, over none of its body', async () => {
        await act(async () => useDocument.getState().toggleMaximized());
        await until(() => indicator() !== null);
        const cell = page.host.querySelector('[data-split-cell][data-maximized]')!;
        expect(indicator()!.closest('[data-cell-bar]')).toBe(cell.querySelector('[data-cell-bar]'));
        expect(indicator()!.closest('.split-cell-body')).toBeNull();
        expect(indicator()!.textContent).toContain('1 cell hidden');
        expect(indicator()!.querySelector('kbd')).not.toBeNull();
    });

    test('puts the split back when the indicator is pressed', async () => {
        await act(async () => useDocument.getState().toggleMaximized());
        await until(() => indicator() !== null);
        await clickOn(indicator());
        await until(() => useDocument.getState().maximized === null);
        expect(indicator()).toBeNull();
        expect(page.host.querySelector('[data-split-cell][data-maximized]')).toBeNull();
        for (const view of [LEFT, RIGHT]) {
            const cell = page.host.querySelector<HTMLElement>(`[data-split-cell][data-view-id="${view.id}"]`)!;
            expect(cell).not.toBeNull();
            expect(cell.hidden).toBe(false);
            expect(cell.closest('[hidden]')).toBeNull();
            expect(page.host.querySelector(`[data-split-view-id="${view.id}"]`)?.hasAttribute('hidden')).toBe(false);
            expect(cell.style.display).not.toBe('none');
            expect(cell.querySelector('.split-cell-body')?.textContent).toContain('const answer = 42;');
        }
    });
});
