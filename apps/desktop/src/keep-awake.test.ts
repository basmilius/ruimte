import { describe, expect, test } from 'bun:test';
import { createKeepAwakeHold, keepAwakeBlocker, keepAwakeRequestFrom, LEGACY_KEEP_AWAKE, type KeepAwakeBlocker } from './keep-awake';

const MAC_ON_AC = { platform: 'darwin', onBattery: false } as const;
const MAC_ON_BATTERY = { platform: 'darwin', onBattery: true } as const;

describe('the block a request comes down to', () => {
    test('none without a request', () => {
        expect(keepAwakeBlocker(null, MAC_ON_AC)).toBeNull();
    });

    test('the system only, unless the display was asked for as well', () => {
        expect(keepAwakeBlocker({ onBattery: false, display: false }, MAC_ON_AC)).toBe('prevent-app-suspension');
        expect(keepAwakeBlocker({ onBattery: false, display: true }, MAC_ON_AC)).toBe('prevent-display-sleep');
    });

    test('on battery only when that was asked for', () => {
        expect(keepAwakeBlocker({ onBattery: false, display: true }, MAC_ON_BATTERY)).toBeNull();
        expect(keepAwakeBlocker({ onBattery: true, display: true }, MAC_ON_BATTERY)).toBe('prevent-display-sleep');
    });

    test('nothing off macOS, whatever was asked', () => {
        expect(keepAwakeBlocker(LEGACY_KEEP_AWAKE, { platform: 'linux', onBattery: false })).toBeNull();
        expect(keepAwakeBlocker(LEGACY_KEEP_AWAKE, { platform: 'win32', onBattery: false })).toBeNull();
    });

    test('an older client keeps what it always had: the system, on any power source', () => {
        expect(keepAwakeBlocker(LEGACY_KEEP_AWAKE, MAC_ON_BATTERY)).toBe('prevent-app-suspension');
    });
});

describe('a request over IPC', () => {
    test('reads only a true as a yes', () => {
        expect(keepAwakeRequestFrom({ onBattery: true, display: 'yes' })).toEqual({ onBattery: true, display: false });
    });

    test('asks for nothing when it is no request at all', () => {
        expect(keepAwakeRequestFrom(null)).toBeNull();
        expect(keepAwakeRequestFrom(true)).toBeNull();
    });
});

describe('the hold', () => {
    const fake = () => {
        const log: string[] = [];
        const started = new Set<number>();
        let next = 0;
        const hold = createKeepAwakeHold({
            start(type: KeepAwakeBlocker) {
                next += 1;
                started.add(next);
                log.push(`start ${type} ${next}`);
                return next;
            },
            stop(id: number) {
                started.delete(id);
                log.push(`stop ${id}`);
            },
            isStarted: (id: number) => started.has(id)
        });
        return { hold, log, started };
    };

    test('starts one block and leaves it alone while the type stays', () => {
        const { hold, log } = fake();
        hold('prevent-app-suspension');
        hold('prevent-app-suspension');
        expect(log).toEqual(['start prevent-app-suspension 1']);
    });

    test('a new type starts before the old one stops, so there is never a gap', () => {
        const { hold, log, started } = fake();
        hold('prevent-app-suspension');
        hold('prevent-display-sleep');
        expect(log).toEqual(['start prevent-app-suspension 1', 'start prevent-display-sleep 2', 'stop 1']);
        expect([...started]).toEqual([2]);
    });

    test('lets go of the block, and does nothing when there is none', () => {
        const { hold, log, started } = fake();
        hold(null);
        hold('prevent-display-sleep');
        hold(null);
        hold(null);
        expect(log).toEqual(['start prevent-display-sleep 1', 'stop 1']);
        expect(started.size).toBe(0);
    });
});
