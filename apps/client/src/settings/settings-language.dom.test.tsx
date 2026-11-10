import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import i18next from 'i18next';
import { act } from 'react';
import { forgetMemoizedWords } from '@/compiler-runtime';
import { chooseLanguage } from '@/i18n/index';
import { startSharedStorage } from '@/shared-storage';
import { SETTINGS_STORAGE_KEY, useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';
import { emptyCanvas } from '../../testing/project-fixtures';

const MAIN = emptyCanvas();

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;
let language: string;
let documentLanguage: string;

function dialogText(): string {
    return document.querySelector('[role="dialog"]')?.textContent ?? '';
}

beforeEach(async () => {
    // What `initI18n` does in the app, which the tests' own setup leaves out.
    i18next.on('languageChanged', forgetMemoizedWords);
    language = useSettings.getState().language;
    documentLanguage = document.documentElement.lang;
    machine = new FakeMachine();
    workspace = await openFakeWorkspace(machine, { views: [MAIN] }, { activeViewId: MAIN.id, views: {} });
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => {
        // The whole state, the row a search led to included: a later file in this process opens the dialog from it.
        useUi.setState({ settings: { open: false, section: 'general', target: null, searchAt: 0 } });
        useSettings.getState().update({ language });
        await i18next.changeLanguage('en');
        document.documentElement.lang = documentLanguage;
    });
    i18next.off('languageChanged', forgetMemoizedWords);
    await page.unmount();
    workspace.close();
});

describe('Settings navigation and language', () => {
    test('names its sections and the open pane in the language picked while it is open', async () => {
        await act(async () => useUi.getState().setSettings({ open: true, section: 'general' }));
        await until(() => dialogText().includes('Keyboard'));
        expect(dialogText()).toContain('Appearance');
        await until(() => document.querySelector('[data-settings-row="general.language"]') !== null);
        expect(document.querySelector('[data-settings-row="general.language"]')?.textContent).toContain('Language');
        expect(dialogText()).not.toContain('Could not show this settings page');

        await act(async () => {
            await chooseLanguage('nl');
        });

        await until(() => dialogText().includes('Toetsenbord'));
        expect(dialogText()).toContain('Uiterlijk');
        expect(dialogText()).toContain('Werkruimte');
        expect(dialogText()).not.toContain('Appearance');
        expect(document.querySelector('[data-settings-row="general.language"]')?.textContent).toContain('Taal');
        expect(document.querySelector('[data-settings-row="general.language"]')?.textContent).not.toContain('Language');
        expect(dialogText()).toContain('Taal en regio');
        expect(dialogText()).not.toContain('Could not show this settings page');
    });

    test('follows a language another window picked', async () => {
        const listeners = new Set<(event: StorageEvent) => void>();
        const otherWindows = {
            addEventListener: (_type: string, listener: (event: StorageEvent) => void) => void listeners.add(listener),
            removeEventListener: (_type: string, listener: (event: StorageEvent) => void) => void listeners.delete(listener)
        };
        const stop = startSharedStorage(otherWindows as unknown as Window);
        await act(async () => useUi.getState().setSettings({ open: true, section: 'general' }));
        await until(() => dialogText().includes('Keyboard'));

        try {
            await act(async () => {
                const stored = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY) ?? '{}') as Record<string, unknown>;
                localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify({ ...stored, language: 'nl' }));
                listeners.forEach((listener) => listener({ key: SETTINGS_STORAGE_KEY } as StorageEvent));
            });
            await until(() => dialogText().includes('Toetsenbord'));
            expect(dialogText()).not.toContain('Appearance');
        } finally {
            stop();
        }
    });

    test('a shortcut search opens the category and highlights the real keyboard row', async () => {
        await act(async () => useUi.getState().setSettings({ open: true, section: 'general' }));
        await until(() => document.querySelector('[data-settings-row="general.language"]') !== null);
        const field = document.querySelector<HTMLInputElement>('[role="dialog"] input')!;
        await act(async () => {
            Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(field, 'zoom out');
            field.dispatchEvent(new Event('input', { bubbles: true }));
        });
        const result = [...document.querySelectorAll('[role="dialog"] li button')].find((button) => button.textContent?.includes('Zoom out'));
        await clickOn(result ?? null);
        await until(() => [...document.querySelectorAll('[data-settings-row]')].some((row) => row.textContent?.includes('Zoom out')));
        const row = [...document.querySelectorAll('[data-settings-row]')].find((candidate) => candidate.textContent?.includes('Zoom out'))!;
        expect(row.getAttribute('data-settings-row')).toStartWith('keyboard.canvas.');
        expect(row.classList.contains('bg-accent-soft')).toBe(true);
        expect(row.textContent).toContain('-');
        expect(dialogText()).not.toContain('Could not show this settings page');
    });
});
