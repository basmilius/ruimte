import { afterEach, beforeEach, describe, expect, test } from 'bun:test';
import { useSettings } from '@/state/settings';
import { useWindow } from '@/workspace/window';
import { clickOn, mount, until, type Mounted } from '../../testing/dom';
import { buttonWithText, everything } from '../../testing/dom-helpers';
import { startBreakReminder } from './break-reminder';

const NOW = new Date(2026, 10, 4, 10, 0).getTime();

let page: Mounted;
let stop: () => void;
let before: ReturnType<typeof useSettings.getState>;

beforeEach(async () => {
    useWindow.getState().setBooting(false);
    before = useSettings.getState();
    useSettings.setState({ breakReminderOn: true, breakReminderMinutes: 50, quietHoursOn: false });
    // A stretch that began 55 minutes ago and was seen a moment ago.
    localStorage.setItem('ruimte.break-reminder', JSON.stringify({ startedAt: NOW - 55 * 60_000, seenAt: NOW - 1_000, extraMs: 0, stage: 'waiting' }));
    page = mount();
    await page.renderApp();
});

afterEach(async () => {
    stop();
    localStorage.removeItem('ruimte.break-reminder');
    await page.unmount();
    useSettings.setState({ breakReminderOn: before.breakReminderOn, breakReminderMinutes: before.breakReminderMinutes, quietHoursOn: before.quietHoursOn });
});

describe('the break reminder toast', () => {
    test('says how long the work went on and offers Take a break and Later', async () => {
        stop = startBreakReminder({ idleState: async () => 'active', focused: () => true, now: () => NOW });
        await until(() => everything().includes('Time for a break?'));
        expect(everything()).toContain('You have worked 55 min without a break.');
        expect(buttonWithText('Take a break')).not.toBeNull();
        expect(buttonWithText('Later')).not.toBeNull();
    });

    test('Take a break closes it and ends the stretch', async () => {
        stop = startBreakReminder({ idleState: async () => 'active', focused: () => true, now: () => NOW });
        await until(() => buttonWithText('Take a break') !== null);
        await clickOn(buttonWithText('Take a break'));
        await until(() => !everything().includes('Time for a break?'));
        expect(localStorage.getItem('ruimte.break-reminder')).toBeNull();
    });

    test('Later closes it and keeps the stretch going', async () => {
        stop = startBreakReminder({ idleState: async () => 'active', focused: () => true, now: () => NOW });
        await until(() => buttonWithText('Later') !== null);
        await clickOn(buttonWithText('Later'));
        await until(() => !everything().includes('Time for a break?'));
        expect(JSON.parse(localStorage.getItem('ruimte.break-reminder') ?? '{}')).toMatchObject({ extraMs: 15 * 60_000, stage: 'waiting' });
    });
});
