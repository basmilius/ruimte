import { expect, test } from 'bun:test';
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
