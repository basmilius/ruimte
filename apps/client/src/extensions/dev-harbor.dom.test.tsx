import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import type { LoadedExtension } from '@/extensions/host/client-api';
import { projectSettingsAsk } from '@/project/dialogs';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { everything } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { FAKE_PROJECT, openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { loadProduct } from '../../testing/poc';

const KEPT = `project:${FAKE_PROJECT.projectId}:setting.service`;

let extension: LoadedExtension;
let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function tab(name: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"] [role="tab"]')].find((candidate) => candidate.textContent?.trim() === name) ?? null;
}

beforeAll(async () => {
    extension = await loadProduct('harbor', 'Harbor');
});
afterAll(() => {
    extension.disposers.forEach((dispose) => dispose());
});

beforeEach(async () => {
    machine = new FakeMachine();
    // The machine holds what a person chose before, as it would after another computer set it.
    machine.answer('extension.storageGet', ({ key }) => ({ value: key === KEPT ? 'api' : undefined }));
    machine.answer('extension.storageSet', () => ({}));
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} } as never);
    page = mount();
    await page.renderApp();
    await act(async () => projectSettingsAsk.set(true));
    await until(() => tab('Harbor') !== null);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe("Harbor in a project's settings", () => {
    test('has a section of its own after those of Ruimte, with the service the machine holds for this project', async () => {
        await clickOn(tab('Harbor'));
        await until(() => everything().includes('Service for shells'));
        await until(() => document.querySelector('[role="dialog"] [aria-label="Service for shells"]')?.textContent?.includes('api') === true);

        expect(machine.requests('extension.storageGet')).toContainEqual({ id: 'dev.harbor', key: KEPT });
    });

    test('keeps the service a person picks with what Harbor stores on the machine for this project', async () => {
        await clickOn(tab('Harbor'));
        await until(() => document.querySelector('[role="dialog"] [aria-label="Service for shells"]') !== null);
        await clickOn(document.querySelector('[role="dialog"] [aria-label="Service for shells"]'));
        await until(() => document.querySelector('[role="option"]') !== null);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.trim() === 'db') ?? null);
        await until(() => machine.requests('extension.storageSet').length > 0);

        expect(machine.requests('extension.storageSet')).toEqual([{ id: 'dev.harbor', key: KEPT, value: 'db' }]);
    });
});
