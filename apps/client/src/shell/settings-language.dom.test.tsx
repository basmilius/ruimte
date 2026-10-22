import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import i18next from 'i18next';
import type { ProjectCanvasView } from '@ruimte/contracts';
import { forgetMemoizedWords } from '@/compiler-runtime';
import dutchSettings from '@/i18n/locales/nl/settings.json' with { type: 'json' };
import { useUi } from '@/state/ui';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { mount, until, type Mounted } from '../../testing/dom';

const MAIN: ProjectCanvasView = { kind: 'canvas', id: 'main', name: 'Main', nodes: [], texts: [], edges: [], layouts: [] };

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function dialogText(): string {
    return document.querySelector('[role="dialog"]')?.textContent ?? '';
}

beforeEach(async () => {
    // What `initI18n` does in the app, which the tests' own setup leaves out.
    i18next.on('languageChanged', forgetMemoizedWords);
    i18next.addResourceBundle('nl', 'settings', dutchSettings, true, true);
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => {
        useUi.getState().setSettings({ open: false });
        await i18next.changeLanguage('en');
    });
    i18next.off('languageChanged', forgetMemoizedWords);
    await page.unmount();
    workspace.close();
});

describe('Settings in another language', () => {
    test('names its sections and the open pane in the language picked while it is open', async () => {
        await act(async () => useUi.getState().setSettings({ open: true, section: 'appearance' }));
        await until(() => dialogText().includes('Keyboard'));
        expect(dialogText()).toContain('Appearance');

        await act(async () => {
            await i18next.changeLanguage('nl');
        });

        await until(() => dialogText().includes('Toetsenbord'));
        expect(dialogText()).toContain('Uiterlijk');
        expect(dialogText()).toContain('Werkruimte');
        expect(dialogText()).not.toContain('Appearance');
    });
});
