import { afterEach, expect, jest, test } from 'bun:test';
import { applyPalette, usePalette } from './palette';

test('a palette goes into one stylesheet, and only a change of it counts as a new revision', () => {
    // Colors no other test picks: loading the settings already wrote the default accent.
    const before = usePalette.getState().revision;
    applyPalette({ light: { accent: '#123456' }, dark: { accent: '#123456' } });
    const style = document.getElementById('ruimte-palette');
    expect(style?.textContent).toContain('--accent: #123456;');
    expect(usePalette.getState().revision).toBe(before + 1);
    // The root carries the revision so the observers of its attributes read the tokens again; the color
    // itself stays off the root, where it would be one for both sides.
    expect(document.documentElement.style.getPropertyValue('--palette-revision')).toBe(String(before + 1));
    expect(document.documentElement.style.getPropertyValue('--accent')).toBe('');

    applyPalette({ light: { accent: '#123456' }, dark: { accent: '#123456' } });
    expect(usePalette.getState().revision).toBe(before + 1);

    applyPalette({ light: { accent: '#123456' }, dark: { accent: '#f54900' } });
    expect(document.querySelectorAll('#ruimte-palette')).toHaveLength(1);
    expect(style?.textContent).toContain('--accent: #f54900;');
    expect(usePalette.getState().revision).toBe(before + 2);
});

afterEach(() => {
    jest.useRealTimers();
});

test('a preview shows at once, and what paints outside the stylesheet follows once the pointer rests', () => {
    jest.useFakeTimers();
    applyPalette({ light: { accent: '#123456' }, dark: { accent: '#123456' } });
    const before = usePalette.getState().revision;
    // A sweep over three swatches: the stylesheet follows each, the revision only the last.
    for (const accent of ['#aa0000', '#00aa00', '#0000aa']) {
        applyPalette({ light: { accent }, dark: { accent } }, { preview: true });
        jest.advanceTimersByTime(20);
    }
    expect(document.getElementById('ruimte-palette')?.textContent).toContain('--accent: #0000aa;');
    expect(usePalette.getState()).toMatchObject({ revision: before, previewing: true });
    jest.advanceTimersByTime(60);
    expect(usePalette.getState()).toMatchObject({ revision: before + 1, previewing: true });
});

test('the end of a preview counts as a change of the picked colors, which is what the window behind the page hears', () => {
    jest.useFakeTimers();
    applyPalette({ light: { accent: '#123456' }, dark: { accent: '#123456' } });
    const before = usePalette.getState().revision;
    applyPalette({ light: { accent: '#aa0000' }, dark: { accent: '#aa0000' } }, { preview: true });
    // Back to the picked colors before the preview settled: no revision for the preview, one for the end.
    applyPalette({ light: { accent: '#123456' }, dark: { accent: '#123456' } });
    expect(usePalette.getState()).toMatchObject({ revision: before + 1, previewing: false });
    jest.advanceTimersByTime(200);
    expect(usePalette.getState().revision).toBe(before + 1);
});
