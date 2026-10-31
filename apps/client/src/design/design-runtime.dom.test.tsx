import { expect, test } from 'bun:test';
import { DESIGN_METHODS } from './design-protocol';
import { DESIGN_RUNTIME } from './design-runtime';

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
