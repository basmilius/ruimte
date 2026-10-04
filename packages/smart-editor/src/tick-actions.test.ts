import { describe, expect, test } from 'bun:test';
import { mountEditor } from './testing.ts';

const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

function setup() {
    const text = Array.from({ length: 40 }, (_, index) => `let value${index} = ${index};`).join('\n');
    const mounted = mountEditor({ text });
    mounted.editor.setMarkers([
        { range: range(3, 4, 10), severity: 'error', message: 'Cannot find name' },
        { range: range(30, 4, 10), severity: 'warning', message: 'Unused' },
        { range: range(12, 0, 3), severity: 'hint', deprecated: true, message: 'Not a tick' }
    ]);
    const { host, window } = mounted.page;
    const fire = (target: Element, type: string): Event => {
        const event = new (window as unknown as { Event: typeof Event }).Event(type, { bubbles: true, cancelable: true });
        target.dispatchEvent(event);
        return event;
    };
    return { ...mounted, host, fire };
}

describe('the ticks of problems in the scroll track', () => {
    test('carry where the problem is and what it says, and only a problem does', () => {
        const { editor, host } = setup();
        const ticks = [...host.querySelectorAll('.se-tick[data-offset]')];
        expect(ticks.map((tick) => tick.getAttribute('data-title'))).toEqual(expect.arrayContaining(['Cannot find name', 'Unused']));
        expect(ticks).toHaveLength(2);
        expect(host.querySelectorAll('.se-tick-tip')).toHaveLength(1);
        editor.dispose();
    });

    test('say it in a tip beside the track while the pointer is on the tick', () => {
        const { editor, host, fire } = setup();
        const tick = host.querySelector('.se-tick-error[data-offset]')!;
        const tip = host.querySelector('.se-tick-tip') as HTMLElement;
        expect(tip.hidden).toBe(true);
        fire(tick, 'pointerover');
        expect(tip.hidden).toBe(false);
        expect(tip.textContent).toBe('Cannot find name');
        fire(tick, 'pointerout');
        expect(tip.hidden).toBe(true);
        editor.dispose();
    });

    test('put the caret on the problem when pressed', () => {
        const { editor, host, fire } = setup();
        const tick = host.querySelector('.se-tick-warning[data-offset]')!;
        const event = fire(tick, 'pointerdown');
        expect(event.defaultPrevented).toBe(true);
        expect(editor.getCaret()).toEqual({ line: 30, character: 4 });
        editor.dispose();
    });

    test('follow their text, so a press after an edit still goes to the problem', () => {
        const { editor, host, fire } = setup();
        editor.applyEdits([{ range: range(0, 0, 0), text: '// first\n' }]);
        fire(host.querySelector('.se-tick-error[data-offset]')!, 'pointerdown');
        expect(editor.getCaret()).toEqual({ line: 4, character: 4 });
        editor.dispose();
    });
});
