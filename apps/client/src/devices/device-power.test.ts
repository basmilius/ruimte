import { describe, expect, test } from 'bun:test';
import { BatteryCharging, BatteryFull, BatteryLow, BatteryMedium, BatteryWarning } from 'lucide-react';
import { powerLook } from './device-power';

describe('powerLook', () => {
    test('a phone on power charges, is full, or names what it hangs on', () => {
        expect(powerLook({ level: 82, plugged: true, charging: true, source: 'usb' })).toMatchObject({
            icon: BatteryCharging,
            tone: 'muted',
            level: '82%',
            tooltip: 'On power (USB) · charging'
        });
        expect(powerLook({ level: 100, plugged: true, charging: false, source: 'ac' }).tooltip).toBe('On power (AC) · full');
        expect(powerLook({ level: 90, plugged: true, charging: false }).tooltip).toBe('On power · not charging');
        expect(powerLook({ level: 90, plugged: true, charging: true, source: 'solar' }).tooltip).toBe('On power · charging');
    });

    test('a phone on its battery shows how full it is, and warns below 20%', () => {
        expect(powerLook({ level: 70, plugged: false, charging: false })).toMatchObject({ icon: BatteryFull, tone: 'muted', tooltip: 'On battery' });
        expect(powerLook({ level: 40, plugged: false, charging: false }).icon).toBe(BatteryMedium);
        expect(powerLook({ level: 20, plugged: false, charging: false })).toMatchObject({ icon: BatteryLow, tone: 'muted' });
        expect(powerLook({ level: 19, plugged: false, charging: false })).toMatchObject({
            icon: BatteryWarning,
            tone: 'needsYou',
            tooltip: 'Battery low · not on power'
        });
        expect(powerLook({ level: 5, plugged: true, charging: true }).tone).toBe('muted');
    });

    test('a simulated level says so and never warns', () => {
        expect(powerLook({ level: 10, plugged: false, charging: false, simulated: true })).toMatchObject({
            tone: 'muted',
            simulated: true,
            tooltip: 'Simulated: apps see 10%. Reset it in the tools.'
        });
    });
});
