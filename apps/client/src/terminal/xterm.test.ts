import { describe, expect, test } from 'bun:test';
import { isApplePlatform } from '@adecore/ui';
import type { Terminal } from '@xterm/xterm';
import { bindTerminalKeys } from './xterm';

type KeyHandler = (event: KeyboardEvent) => boolean;

function bind(keys: Partial<Parameters<typeof bindTerminalKeys>[1]>): KeyHandler {
    let handler: KeyHandler | null = null;
    const term = { element: undefined, modes: {}, attachCustomKeyEventHandler: (next: KeyHandler) => (handler = next) } as unknown as Terminal;
    bindTerminalKeys(term, { write: () => {}, clear: () => {}, leaves: false, ...keys });
    return handler!;
}

/* The find key of the platform the test runs on, as the bits of a keydown the handler reads. */
function findKey(): KeyboardEvent & { prevented: boolean } {
    const apple = isApplePlatform();
    const event = {
        type: 'keydown',
        key: apple ? 'f' : 'F',
        code: 'KeyF',
        metaKey: apple,
        ctrlKey: !apple,
        shiftKey: !apple,
        altKey: false,
        prevented: false,
        preventDefault: () => (event.prevented = true),
        stopPropagation: () => {}
    };
    return event as unknown as KeyboardEvent & { prevented: boolean };
}

describe('the find key of a terminal', () => {
    test('opens the bar and is neither written nor passed on', () => {
        let opened = 0;
        const handler = bind({ find: () => opened++ });
        const event = findKey();

        expect(handler(event)).toBe(false);
        expect(opened).toBe(1);
        expect(event.prevented).toBe(true);
    });

    test('stays with the program in a terminal that has no bar', () => {
        const event = findKey();

        expect(bind({})(event)).toBe(true);
        expect(event.prevented).toBe(false);
    });
});
