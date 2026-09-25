import { describe, expect, test } from 'bun:test';
import { createPageKeys, PAGE_KEY_MS } from './page-keys';

const COMMAND_T = { type: 'keyDown', meta: true, control: false };

const at = (start: number) => {
    let time = start;
    return { now: () => time, pass: (ms: number) => (time += ms) };
};

describe('whether the page had the key that fired a menu item', () => {
    test('yes right after it had a key with Cmd', () => {
        const clock = at(0);
        const keys = createPageKeys(clock.now);
        keys.saw(COMMAND_T);
        clock.pass(40);
        expect(keys.take()).toBe(true);
    });

    test('no when it had no key at all, as for a pick through accessibility or a key sent to the app behind', () => {
        expect(createPageKeys(at(0).now).take()).toBe(false);
    });

    test('no once the key is too long ago', () => {
        const clock = at(0);
        const keys = createPageKeys(clock.now);
        keys.saw(COMMAND_T);
        clock.pass(PAGE_KEY_MS + 1);
        expect(keys.take()).toBe(false);
    });

    test('a key answers one item only', () => {
        const keys = createPageKeys(at(0).now);
        keys.saw(COMMAND_T);
        expect(keys.take()).toBe(true);
        expect(keys.take()).toBe(false);
    });

    test('a held key answers as many items as it repeated', () => {
        const keys = createPageKeys(at(0).now);
        keys.saw(COMMAND_T);
        keys.saw(COMMAND_T);
        expect(keys.take()).toBe(true);
        expect(keys.take()).toBe(true);
        expect(keys.take()).toBe(false);
    });

    test('a key without Cmd or Ctrl, or its release, is no key a menu binds', () => {
        const keys = createPageKeys(at(0).now);
        keys.saw({ type: 'keyDown', meta: false, control: false });
        keys.saw({ type: 'keyUp', meta: true, control: false });
        expect(keys.take()).toBe(false);
        keys.saw({ type: 'keyDown', meta: false, control: true });
        expect(keys.take()).toBe(true);
    });
});
