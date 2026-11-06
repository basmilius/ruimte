import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { projectSettingsAsk } from '@/project/dialogs';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { FakeMachine } from '../../testing/fake-machine';
import { openFakeWorkspace, type FakeWorkspace } from '../../testing/fake-workspace';

const RED = '#e7000b';
const previousGlow = useSettings.getState().projectGlow;

let machine: FakeMachine;
let workspace: FakeWorkspace;
let page: Mounted;

function swatch(name: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[role="radio"][aria-label="${name}"]`);
}

function glowIn(selector: string): HTMLElement | null {
    return page.host.querySelector<HTMLElement>(`${selector} .sidebar-glow`);
}

beforeEach(async () => {
    machine = new FakeMachine();
    machine.answer('project.save', ({ baseRev }) => ({ rev: baseRev + 1 }) as never);
    workspace = await openFakeWorkspace(machine, { views: [] } as never, { activeViewId: null, views: {} } as never);
    useSettings.setState({ projectGlow: true });
    await act(async () => useUi.getState().setSidebarOpen(true));
    page = mount();
    await page.renderApp();
    await until(() => glowIn('#app-sidebar') !== null);
});

afterEach(async () => {
    await act(async () => useUi.getState().setSidebarOpen(true));
    await page.unmount();
    useSettings.setState({ projectGlow: previousGlow });
    workspace.close();
});

async function pickRed(): Promise<void> {
    await act(async () => projectSettingsAsk.set(true));
    await until(() => swatch('Red') !== null);
    await clickOn(swatch('Red'));
    await until(() => glowIn('#app-sidebar')?.dataset.glowColor === RED);
}

describe('the color of a project', () => {
    test('picked in its settings, it is the color of the glow at once', async () => {
        expect(glowIn('#app-sidebar')?.dataset.glowColor).toBe('#000');
        await pickRed();
        expect(swatch('Red')!.getAttribute('aria-checked')).toBe('true');
        // Every menu of the project can open its settings, and only one of them answers the ask.
        expect(document.querySelectorAll('[role="dialog"]')).toHaveLength(1);
    });

    test('with the sidebar closed the same glow stands at the top of the toolbar', async () => {
        await pickRed();
        await act(async () => useUi.getState().setSidebarOpen(false));
        await until(() => glowIn('[data-toolbar-glow]') !== null);
        expect(glowIn('[data-toolbar-glow]')!.dataset.glowColor).toBe(RED);
    });

    test('without the setting the project tint is absent', async () => {
        await act(async () => useSettings.setState({ projectGlow: false }));
        await until(() => glowIn('#app-sidebar')?.dataset.glowColor === undefined);
        expect(glowIn('#app-sidebar')!.classList.contains('project-glow')).toBe(false);
    });
});
