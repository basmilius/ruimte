import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { act } from 'react';
import { useSettings } from '@/state/settings';
import { useUi } from '@/state/ui';
import { useWindow } from '@/workspace/window';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything, installDesktop, removeDesktop, typeInto } from '../../testing/dom-helpers';
import { connectFakeMachine, FakeMachine } from '../../testing/fake-machine';

let page: Mounted;
let release: () => void;
let before: ReturnType<typeof useSettings.getState>;

function switchOf(label: string): HTMLElement | null {
    return document.querySelector<HTMLElement>(`[role="switch"][aria-label="${label}"]`);
}

function timeInput(label: string): HTMLInputElement | null {
    return document.querySelector<HTMLInputElement>(`input[type="time"][aria-label="${label}"]`);
}

async function open(idleState: boolean): Promise<void> {
    release = connectFakeMachine(new FakeMachine());
    installDesktop(idleState ? { idleState: async () => 'active' } : {});
    page = mount();
    await page.renderApp();
    await act(async () => useUi.getState().setSettings({ open: true, section: 'agents', target: 'agents.quietHours' }));
    await until(() => everything().includes('Quiet hours'));
}

beforeEach(() => {
    useWindow.getState().setBooting(false);
    before = useSettings.getState();
});

afterEach(async () => {
    await act(async () => useUi.getState().setSettings({ open: false, target: null }));
    await page.unmount();
    release();
    removeDesktop();
    useSettings.setState({
        quietHoursOn: before.quietHoursOn,
        quietHoursDays: before.quietHoursDays,
        quietHoursStart: before.quietHoursStart,
        quietHoursEnd: before.quietHoursEnd,
        breakReminderOn: before.breakReminderOn,
        breakReminderMinutes: before.breakReminderMinutes
    });
});

describe('Settings > Agents > Notifications > Quiet hours', () => {
    test('is off with no days or times until it is turned on', async () => {
        await open(false);
        expect(switchOf('Quiet hours')?.getAttribute('aria-checked')).toBe('false');
        expect(timeInput('Quiet from')).toBeNull();
        expect(buttonWithText('Mon')).toBeNull();
    });

    test('turned on, it offers days and times and keeps what is chosen', async () => {
        await open(false);
        await clickOn(switchOf('Quiet hours'));
        expect(useSettings.getState().quietHoursOn).toBe(true);
        await until(() => timeInput('Quiet from') !== null);
        expect(timeInput('Quiet from')?.value).toBe('22:00');
        expect(timeInput('Quiet until')?.value).toBe('07:00');

        await typeInto(timeInput('Quiet from')!, '23:30');
        await typeInto(timeInput('Quiet until')!, '06:15');
        expect(useSettings.getState()).toMatchObject({ quietHoursStart: '23:30', quietHoursEnd: '06:15' });

        await clickOn(buttonWithText('Sat'));
        await clickOn(buttonWithText('Sun'));
        expect(useSettings.getState().quietHoursDays).toEqual([1, 2, 3, 4, 5]);
        expect(buttonWithText('Sat')?.getAttribute('aria-pressed')).toBe('false');
    });

    test('keeps one day, since hours on no day would never be quiet', async () => {
        useSettings.setState({ quietHoursOn: true, quietHoursDays: [3] });
        await open(false);
        await until(() => buttonWithText('Wed') !== null);
        expect(buttonWithText('Wed')?.disabled).toBe(true);
    });
});

describe('Settings > Agents > Notifications > Break reminder', () => {
    test('is not offered where the system cannot say whether a person is there', async () => {
        await open(false);
        expect(everything()).not.toContain('Break reminder');
    });

    test('is off to start with, and turning it on offers the stretch', async () => {
        await open(true);
        await until(() => switchOf('Break reminder') !== null);
        expect(switchOf('Break reminder')?.getAttribute('aria-checked')).toBe('false');
        expect(everything()).not.toContain('Remind me after');

        await clickOn(switchOf('Break reminder'));
        expect(useSettings.getState().breakReminderOn).toBe(true);
        await until(() => everything().includes('Remind me after'));
        expect(everything()).toContain('50 min');
    });
});
