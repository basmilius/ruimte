import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { CodeSection } from '@/settings/panes/CodeSection';
import { EditorGeneralTab } from '@/settings/panes/EditorGeneralTab';
import { FontSection } from '@/settings/panes/FontSection';
import { TerminalPane } from '@/settings/panes/TerminalPane';
import { useSettings } from '@/state/settings';
import { useTheme } from '@/state/theme';
import { clickOn, mount, until, type Mounted } from '../../../testing/dom';
import { buttonWithText, everything } from '../../../testing/dom-helpers';

let page: Mounted;

beforeEach(async () => {
    await act(async () => {
        useSettings.getState().update({ font: 'system', terminalFont: 'editor' });
        useTheme.getState().setTheme('dark');
    });
});

afterEach(async () => {
    await page.unmount();
    await act(async () => useTheme.getState().setTheme('system'));
});

describe('Settings > fonts', () => {
    test('the Editor tab holds the editor font and the General tab no monospace font', async () => {
        page = mount();
        await page.render(<EditorGeneralTab />);
        await until(() => everything().includes('Editor font'));
        await page.unmount();

        page = mount();
        await page.render(<FontSection />);
        await until(() => everything().includes('Interface font'));
        expect(everything()).not.toContain('Monospace font');
        expect(everything()).not.toContain('Editor font');
    });

    test('the Terminal tab offers to follow the editor and picks its own font', async () => {
        page = mount();
        await page.render(<TerminalPane />);
        await until(() => buttonWithText('Same as Editor') !== null);
        expect(everything()).toContain('Terminal font');
        await clickOn(buttonWithText('Same as Editor'));
        await until(() => document.querySelector('[role="option"]') !== null);
        await clickOn([...document.querySelectorAll('[role="option"]')].find((option) => option.textContent?.includes('Fira Code')) ?? null);
        expect(useSettings.getState().terminalFont).toBe('fira');
        expect(useSettings.getState().font).toBe('system');
    });
});

describe('Settings > Editor > code themes', () => {
    test('both previews show while the app is dark, each on the surface of its own mode', async () => {
        page = mount();
        await page.render(<CodeSection />);
        await until(() => document.querySelectorAll('.code-theme-preview').length === 2);

        const modes = [...document.querySelectorAll('.code-theme-preview > [data-theme]')].map((surface) => surface.getAttribute('data-theme'));

        expect(modes).toEqual(['light', 'dark']);
    });
});
