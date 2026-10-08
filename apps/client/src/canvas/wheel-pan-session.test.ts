import { expect, test } from 'bun:test';
import { createWheelPanSession, PAN_IDLE_MS } from './wheel-pan-session';

test('a pan keeps the wheel when the pointer crosses the focused node or Space is released', () => {
    const pan = createWheelPanSession();
    expect(pan.owns(false, 0)).toBe(false);
    expect(pan.owns(true, 0)).toBe(true);
    pan.record(0);
    expect(pan.owns(false, 100)).toBe(true);
    pan.record(100);
    expect(pan.owns(false, 200)).toBe(true);
    expect(pan.owns(false, 100 + PAN_IDLE_MS + 1)).toBe(false);
    pan.record(300);
    pan.reset();
    expect(pan.owns(false, 300)).toBe(false);
});
