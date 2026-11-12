import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { projectSettingsAsk } from '@/project/dialogs';
import { viewDialog } from '@/project/dialogs';
import { mount, pressKey, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function dialogTitled(title: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"]')].find((dialog) => dialog.textContent?.includes(title)) ?? null;
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [MAIN] } as never, { activeViewId: 'main', views: {} } as never);
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => viewDialog.set(null));
    await page.unmount();
    workspace.close();
});

describe('Escape in a settings dialog', () => {
    test('closes View settings while its name field has the focus', async () => {
        await act(async () => viewDialog.set({ kind: 'settings', viewId: 'main' }));
        await until(() => dialogTitled('View settings') !== null);
        const field = document.querySelector<HTMLInputElement>('input[aria-label="View name"]')!;
        expect(document.activeElement).toBe(field);

        await pressKey(field, 'Escape');
        await until(() => dialogTitled('View settings') === null);
    });

    test('closes Project settings while its name field has the focus', async () => {
        await act(async () => projectSettingsAsk.set(true));
        await until(() => document.querySelector('input[aria-label="Project name"]') !== null);
        const field = document.querySelector<HTMLInputElement>('input[aria-label="Project name"]')!;
        await act(async () => field.focus());

        await pressKey(field, 'Escape');
        await until(() => document.querySelector('input[aria-label="Project name"]') === null);
    });
});
