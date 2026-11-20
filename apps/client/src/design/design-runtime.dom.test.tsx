import { expect, test } from 'bun:test';
import { DESIGN_METHODS } from './design-protocol';
import { DESIGN_RUNTIME } from './design-runtime';

test('a press anywhere in a page tells the stage before the page can stop it', () => {
    const posted: { method: string }[] = [];
    const stand = { parent: { postMessage: (message: { method: string }) => posted.push(message) } };
    const capturing: Record<string, () => void> = {};

    new Function('window', 'addEventListener', DESIGN_RUNTIME)(stand, (type: string, listener: () => void, capture?: boolean) => {
        if (capture === true) {
            capturing[type] = listener;
        }
    });
    document.head.innerHTML = '';
    document.body.innerHTML = '';

    capturing.pointerdown();

    expect(posted.map((message) => message.method)).toContain(DESIGN_METHODS.press);
});

test('a canvas page opens at its top left at 100%, and tells the stage only that it is ready', () => {
    const posted: { method: string }[] = [];
    const stand = { parent: { postMessage: (message: { method: string }) => posted.push(message) } };

    document.head.innerHTML = '<meta name="ruimte-design" content="canvas">';
    document.body.innerHTML = '<div id="1a"></div>';

    // The runtime takes the wheel and clicks of its window, which here would be every later test's.
    new Function('window', 'addEventListener', DESIGN_RUNTIME)(stand, () => {});

    const transform = document.getElementById('ruimte-design-world')?.style.transform;

    document.head.innerHTML = '';
    document.body.innerHTML = '';

    expect(transform).toBe('translate(48px, 48px) scale(1)');
    expect(posted.map((message) => message.method)).toEqual([DESIGN_METHODS.ready]);
});

test('a board hands its wheel and a middle drag to the stage, and grabs while it pans', () => {
    const posted: { method: string; params?: unknown }[] = [];
    const stand = { parent: { postMessage: (message: { method: string; params?: unknown }) => posted.push(message) } };
    const listeners: Record<string, (event: object) => void> = {};

    document.head.innerHTML = '<meta name="ruimte-design" content="canvas">';
    document.body.innerHTML = '<div id="1a"></div>';
    new Function('window', 'addEventListener', 'removeEventListener', DESIGN_RUNTIME)(
        stand,
        (type: string, listener: (event: object) => void) => {
            listeners[type] = listener;
        },
        () => undefined
    );

    let prevented = 0;
    const preventDefault = (): void => {
        prevented++;
    };

    listeners.wheel({ deltaX: 3, deltaY: -40, deltaMode: 0, ctrlKey: true, metaKey: false, timeStamp: 7, clientX: 100, clientY: 60, preventDefault });
    listeners.pointerdown({ button: 1, pointerId: 4, clientX: 10, clientY: 10, target: document.getElementById('1a') });
    const grabbing = document.documentElement.classList.contains('ruimte-design-grabbing');
    listeners.mousedown({ button: 1, preventDefault });
    listeners.pointermove({ pointerId: 4, clientX: 25, clientY: 4 });
    listeners.pointerup({ pointerId: 4 });
    const released = !document.documentElement.classList.contains('ruimte-design-grabbing');

    document.head.innerHTML = '';
    document.body.innerHTML = '';

    expect(posted.find((message) => message.method === DESIGN_METHODS.wheel)?.params).toEqual({
        deltaX: 3,
        deltaY: -40,
        deltaMode: 0,
        ctrlKey: true,
        metaKey: false,
        timeStamp: 7,
        x: 100,
        y: 60
    });
    expect(posted.find((message) => message.method === DESIGN_METHODS.pan)?.params).toEqual({ dx: 15, dy: -6 });
    expect(prevented).toBe(2);
    expect(grabbing).toBe(true);
    expect(released).toBe(true);
});
