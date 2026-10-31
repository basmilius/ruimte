import { expect, test } from 'bun:test';
import { DESIGN_METHODS } from './design-protocol';
import { DESIGN_RUNTIME } from './design-runtime';

test('a canvas page opens at its top left at 100%, and tells the stage only that it is ready', () => {
    const posted: { method: string }[] = [];
    const stand = { parent: { postMessage: (message: { method: string }) => posted.push(message) } };

    document.head.innerHTML = '<meta name="ruimte-design" content="canvas">';
    document.body.innerHTML = '<div id="1a"></div>';

    new Function('window', DESIGN_RUNTIME)(stand);

    expect(document.getElementById('ruimte-design-world')?.style.transform).toBe('translate(48px, 48px) scale(1)');
    expect(posted.map((message) => message.method)).toEqual([DESIGN_METHODS.ready]);
});
