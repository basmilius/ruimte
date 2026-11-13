import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { isApplePlatform } from '@adecore/ui';
import { act } from 'react';
import { projectSettingsAsk } from '@/project/dialogs';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { everything, typeInto } from '../../testing/dom-helpers';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

let workspace: FakeWorkspace;
let page: Mounted;

function tabs(): string[] {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"] [role="tab"]')].map((tab) => tab.textContent?.trim() ?? '');
}

function result(label: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="dialog"] li button')].find((row) => row.textContent?.includes(label)) ?? null;
}

beforeEach(async () => {
    workspace = await openFakeWorkspace(new FakeMachine(), { views: [] } as never, { activeViewId: null, views: {} } as never);
    page = mount();
    await page.renderApp();
    await act(async () => projectSettingsAsk.set(true));
    await until(() => tabs().length > 0);
});

afterEach(async () => {
    await page.unmount();
    workspace.close();
});

describe('Project settings', () => {
    test('opens in the dialog of Settings, on the project, with a section per subject', () => {
        expect(tabs()).toEqual(['General', 'Accounts', 'Sounds']);
        expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Project settings');
        expect(everything()).toContain('Atlas');
        expect(document.querySelector<HTMLInputElement>('input[aria-label="Project name"]')?.value).toBe('Atlas');
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    });

    test('opens with the key beside the one of Settings', async () => {
        await clickOn(document.querySelector('[role="dialog"] [aria-label="Close settings"]'));
        await until(() => tabs().length === 0);

        const apple = isApplePlatform();

        await act(async () => {
            document.body.dispatchEvent(
                new KeyboardEvent('keydown', { key: ';', code: 'Semicolon', bubbles: true, cancelable: true, metaKey: apple, ctrlKey: !apple })
            );
        });
        await until(() => tabs().length > 0);
    });

    test('its search finds a row in another section and goes there', async () => {
        await typeInto(document.querySelector<HTMLInputElement>('[role="dialog"] input[aria-label="Search settings"]')!, 'silent');
        await until(() => result('Silent') !== null);
        expect(result('Name')).toBeNull();

        await clickOn(result('Silent'));
        await until(() => document.querySelector('[role="switch"][aria-label="Silent"]') !== null);
    });
});
