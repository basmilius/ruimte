import { describe, expect, test } from 'bun:test';
import { ExecutionStateHold, executionStateOf, type WindowsPower } from './windows-keep-awake.ts';

const RELEASED = 0x80000000;
const SYSTEM = 0x80000001;
const SYSTEM_AND_DISPLAY = 0x80000003;

function fakePower(adapter = true) {
    let changed: (() => void) | null = null;
    const fake: {
        states: number[];
        watches: number;
        adapter: boolean;
        power: WindowsPower;
        unplug(plugged: boolean): void;
        readonly watching: boolean;
    } = {
        states: [],
        watches: 0,
        adapter,
        power: {
            setExecutionState: (flags) => {
                fake.states.push(flags);
                return 1;
            },
            onAdapter: () => fake.adapter,
            watchPowerSource: (listener) => {
                fake.watches++;
                changed = listener;
                return () => {
                    changed = null;
                };
            }
        },
        unplug(plugged: boolean): void {
            fake.adapter = plugged;
            changed?.();
        },
        get watching(): boolean {
            return changed !== null;
        }
    };
    return fake;
}

describe('executionStateOf', () => {
    test('holds the system, and the display when asked', () => {
        expect(executionStateOf({ onBattery: true, display: false }, false)).toBe(SYSTEM);
        expect(executionStateOf({ onBattery: true, display: true }, true)).toBe(SYSTEM_AND_DISPLAY);
    });

    test('lets go without a block and for an adapter-only block on battery', () => {
        expect(executionStateOf(null, true)).toBe(RELEASED);
        expect(executionStateOf({ onBattery: false, display: false }, true)).toBe(SYSTEM);
        expect(executionStateOf({ onBattery: false, display: false }, false)).toBe(RELEASED);
    });
});

describe('ExecutionStateHold', () => {
    test('an adapter-only block follows the power source and stops listening when it ends', () => {
        const fake = fakePower();
        const held = new ExecutionStateHold(fake.power).hold({ onBattery: false, display: false });
        expect(fake.states).toEqual([SYSTEM]);
        fake.unplug(false);
        fake.unplug(true);
        expect(fake.states).toEqual([SYSTEM, RELEASED, SYSTEM]);
        held.kill();
        expect(fake.states.at(-1)).toBe(RELEASED);
        expect(fake.watching).toBe(false);
    });

    test('a block that may hold on battery never listens', () => {
        const fake = fakePower(false);
        new ExecutionStateHold(fake.power).hold({ onBattery: true, display: false });
        expect(fake.states).toEqual([SYSTEM]);
        expect(fake.watches).toBe(0);
    });

    test('ending the old block after the new one started leaves the new one standing', async () => {
        const fake = fakePower();
        const hold = new ExecutionStateHold(fake.power);
        const first = hold.hold({ onBattery: false, display: false });
        hold.hold({ onBattery: true, display: true });
        first.kill();
        await first.exited;
        expect(fake.states).toEqual([SYSTEM, SYSTEM_AND_DISPLAY]);
        expect(fake.watching).toBe(false);
    });

    test('a refused state throws, so the caller holds nothing', () => {
        const fake = fakePower();
        const hold = new ExecutionStateHold({ ...fake.power, setExecutionState: () => 0 });
        expect(() => hold.hold({ onBattery: true, display: false })).toThrow('refused');
    });

    test('a power source it cannot follow releases the state before it throws', () => {
        const fake = fakePower();
        const hold = new ExecutionStateHold({
            ...fake.power,
            watchPowerSource: () => {
                throw new Error('no notifications');
            }
        });
        expect(() => hold.hold({ onBattery: false, display: false })).toThrow('no notifications');
        expect(fake.states).toEqual([SYSTEM, RELEASED]);
    });
});
