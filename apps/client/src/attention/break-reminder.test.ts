import { afterEach, beforeEach, describe, expect, jest, test } from 'bun:test';
import type { SystemIdleState } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { memoryStorage } from '../../testing/memory-storage';
import { startBreakReminder } from './break-reminder';

const MINUTE = 60_000;
const START = new Date(2026, 10, 4, 9, 0).getTime();

let now: number;
let state: SystemIdleState;
let focused: boolean;
let stop: () => void;
let storage: ReturnType<typeof memoryStorage>;
let before: ReturnType<typeof useSettings.getState>;
const originals = new Map<string, PropertyDescriptor | undefined>();

function replace(key: string, value: unknown): void {
    originals.set(key, Object.getOwnPropertyDescriptor(globalThis, key));
    Object.defineProperty(globalThis, key, { configurable: true, value });
}

async function flush(): Promise<void> {
    for (let i = 0; i < 6; i++) {
        await Promise.resolve();
    }
}

/* Lets the clock run in the half minutes the reminder polls at, a poll finishing before the next. */
async function elapse(minutes: number, idle: SystemIdleState = 'active'): Promise<void> {
    state = idle;

    for (let half = 0; half < minutes * 2; half++) {
        now += MINUTE / 2;
        jest.advanceTimersByTime(MINUTE / 2);
        await flush();
    }
}

const toast = () => useToasts.getState().toasts.find((entry) => entry.id === 'break-reminder');

function begin(): void {
    stop = startBreakReminder({ idleState: async () => state, focused: () => focused, now: () => now });
}

beforeEach(() => {
    jest.useFakeTimers();
    now = START;
    state = 'active';
    focused = true;
    storage = memoryStorage();
    before = useSettings.getState();
    replace('localStorage', storage);
    useSettings.setState({ breakReminderOn: true, breakReminderMinutes: 50, quietHoursOn: false });
});

afterEach(() => {
    stop?.();
    useToasts.setState({ toasts: [] });
    useSettings.setState({
        breakReminderOn: before.breakReminderOn,
        breakReminderMinutes: before.breakReminderMinutes,
        quietHoursOn: before.quietHoursOn,
        quietHoursDays: before.quietHoursDays,
        quietHoursStart: before.quietHoursStart,
        quietHoursEnd: before.quietHoursEnd
    });

    for (const [key, descriptor] of originals) {
        if (descriptor) {
            Object.defineProperty(globalThis, key, descriptor);
        } else {
            Reflect.deleteProperty(globalThis, key);
        }
    }

    originals.clear();
    jest.useRealTimers();
});

describe('a stretch of work', () => {
    test('shows a persistent toast with two actions once the stretch is up', async () => {
        begin();
        await elapse(49);
        expect(toast()).toBeUndefined();
        await elapse(2);
        expect(toast()).toMatchObject({
            title: 'Time for a break?',
            persist: true,
            actions: [{ label: 'Take a break' }, { label: 'Later' }]
        });
    });

    test('names how long the stretch lasted', async () => {
        begin();
        await elapse(55);
        expect(toast()?.description).toBe('You have worked 50 min without a break.');
    });

    test('shows the toast once, however long it stays up', async () => {
        begin();
        await elapse(60);
        useToasts.getState().dismiss('break-reminder');
        await elapse(30);
        expect(toast()).toBeUndefined();
    });

    test('Take a break ends the stretch, and the next one starts afresh', async () => {
        begin();
        await elapse(51);
        toast()!.actions![0]!.run();
        expect(toast()).toBeUndefined();
        expect(storage.values.get('ruimte.break-reminder')).toBeUndefined();
        await elapse(40);
        expect(toast()).toBeUndefined();
        await elapse(12);
        expect(toast()).toBeDefined();
    });

    test('Later asks again fifteen minutes on', async () => {
        begin();
        await elapse(51);
        toast()!.actions![1]!.run();
        expect(toast()).toBeUndefined();
        await elapse(13);
        expect(toast()).toBeUndefined();
        await elapse(3);
        expect(toast()).toBeDefined();
    });

    test('five minutes away is a break, so the stretch starts over', async () => {
        begin();
        await elapse(40);
        await elapse(1, 'idle');
        await elapse(40);
        expect(toast()).toBeUndefined();
        await elapse(12);
        expect(toast()).toBeDefined();
    });

    test('a locked screen is a break too', async () => {
        begin();
        await elapse(40);
        await elapse(1, 'locked');
        await elapse(40);
        expect(toast()).toBeUndefined();
    });

    test('an unknown state changes nothing', async () => {
        begin();
        await elapse(40);
        await elapse(12, 'unknown');
        expect(toast()).toBeDefined();
    });

    test('an unknown state never starts a stretch', async () => {
        state = 'unknown';
        begin();
        await elapse(120, 'unknown');
        expect(toast()).toBeUndefined();
    });

    test('a computer that slept through a break does not remind on waking', async () => {
        begin();
        await elapse(40);
        now += 8 * 60 * MINUTE;
        await elapse(1);
        await elapse(20);
        expect(toast()).toBeUndefined();
    });

    test('all windows share the stretch', async () => {
        begin();
        await elapse(40);
        stop();
        begin();
        await elapse(12);
        expect(toast()).toBeDefined();
    });

    test('asks nothing while the setting is off', async () => {
        useSettings.setState({ breakReminderOn: false });
        begin();
        await elapse(120);
        expect(toast()).toBeUndefined();
        expect(storage.values.get('ruimte.break-reminder')).toBeUndefined();
    });

    test('follows a stretch that is changed meanwhile', async () => {
        begin();
        await elapse(20);
        useSettings.setState({ breakReminderMinutes: 30 });
        await elapse(11);
        expect(toast()).toBeDefined();
    });

    test('does nothing where the system cannot say whether a person is there', async () => {
        stop = startBreakReminder({ idleState: null, focused: () => true, now: () => now });
        await elapse(120);
        expect(toast()).toBeUndefined();
        expect(jest.getTimerCount()).toBe(0);
    });
});

describe('in quiet hours', () => {
    beforeEach(() => {
        // The hours follow this computer's clock, so they are built on it: 09:30 to 10:30.
        useSettings.setState({ quietHoursOn: true, quietHoursDays: [1, 2, 3, 4, 5, 6, 7], quietHoursStart: '09:30', quietHoursEnd: '10:30' });
    });

    test('stays silent, and speaks once they end if the work goes on', async () => {
        begin();
        await elapse(85);
        expect(toast()).toBeUndefined();
        await elapse(6);
        expect(toast()).toBeDefined();
    });
});

describe('with no window in front', () => {
    class FakeNotification {
        static permission = 'granted';
        static raised: FakeNotification[] = [];
        onclick: (() => void) | null = null;
        readonly title: string;
        readonly options: NotificationOptions;

        constructor(title: string, options: NotificationOptions) {
            this.title = title;
            this.options = options;
            FakeNotification.raised.push(this);
        }

        close(): void {}
    }

    const raised = FakeNotification.raised;

    beforeEach(() => {
        raised.length = 0;
        focused = false;
        replace('window', { Notification: FakeNotification, focus() {} });
        replace('Notification', FakeNotification);
    });

    test('raises one notification, and opening it shows the toast', async () => {
        begin();
        await elapse(60);
        expect(raised).toHaveLength(1);
        expect(raised[0]).toMatchObject({ title: 'Time for a break?', options: { tag: 'ruimte-break' } });
        expect(toast()).toBeUndefined();
        raised[0]!.onclick!();
        expect(toast()).toBeDefined();
    });

    test('shows the toast instead once a window comes to the front', async () => {
        begin();
        await elapse(55);
        focused = true;
        await elapse(1);
        expect(raised).toHaveLength(1);
        expect(toast()).toBeDefined();
    });
});
