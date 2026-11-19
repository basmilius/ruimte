import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { everything, typeInto } from '../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';

let page: Mounted;
let release: () => void;

function tab(label: string): HTMLElement | null {
    return [...document.querySelectorAll<HTMLElement>('[role="tab"]')].find((candidate) => candidate.textContent?.trim() === label) ?? null;
}

function picked(label: string): boolean {
    return tab(label)?.getAttribute('aria-selected') === 'true';
}

beforeEach(async () => {
    release = connectFakeMachine(new FakeMachine());
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false }));
    await page.unmount();
    release();
});

describe('a section drawn as a tab', () => {
    test('opens in the section of the navigation, on its own tab', async () => {
        await act(async () => useUi.getState().setSettings({ open: true, section: 'appearance' }));
        await until(() => picked('Appearance'));
        expect(picked('General')).toBe(true);
        expect(tab('Notifications')).not.toBeNull();
        expect(everything()).not.toContain('Sound pack');
    });

    test('shows the pane of the tab a person picks', async () => {
        await act(async () => useUi.getState().setSettings({ open: true, section: 'general' }));
        await until(() => tab('Notifications') !== null);
        await clickOn(tab('Notifications'));
        await until(() => everything().includes('Sound pack'));
        expect(useUi.getState().settings.section).toBe('notifications');
        expect(picked('General')).toBe(true);
    });

    test('is where a search result for one of its rows leads', async () => {
        await act(async () => useUi.getState().setSettings({ open: true, section: 'keyboard' }));
        await until(() => document.querySelector('input[aria-label="Search settings"]') !== null);
        await typeInto(document.querySelector<HTMLInputElement>('input[aria-label="Search settings"]')!, 'quiet hours');
        await until(() => document.querySelector('[aria-label="Search results"] button') !== null);
        await clickOn(document.querySelector('[aria-label="Search results"] button'));
        await until(() => picked('Notifications'));
        expect(useUi.getState().settings.section).toBe('notifications');
    });

    test('draws Chats, Computer use and MCP as tabs of Agents, with Tunnels still in the navigation', async () => {
        await act(async () => useUi.getState().setSettings({ open: true, section: 'chats' }));
        await until(() => picked('Chats'));
        expect(picked('Agents')).toBe(true);
        expect(tab('Computer use')).not.toBeNull();
        expect(tab('MCP')).not.toBeNull();
        expect(tab('Tunnels')).not.toBeNull();
    });
});
