import { expect, test } from 'bun:test';
import { VerbRefusal } from './context/verb.ts';
import { ceilingForOpening, modeFlag, narrowerMode } from './modes.ts';

test('a mode is narrowed to its ceiling and never widened by it', () => {
    expect(narrowerMode('full-access', 'auto-accept-edits')).toBe('auto-accept-edits');
    expect(narrowerMode('supervised', 'full-access')).toBe('supervised');
});

test('an opener hands down its own mode and refuses a wider one, naming what it may pick', () => {
    expect(ceilingForOpening('auto', undefined)).toBe('auto');
    expect(ceilingForOpening('auto', 'supervised')).toBe('auto');
    let refusal: unknown = null;
    try {
        ceilingForOpening('auto-accept-edits', 'full-access');
    } catch (e) {
        refusal = e;
    }
    expect(refusal).toBeInstanceOf(VerbRefusal);
    expect((refusal as VerbRefusal).code).toBe('mode-above-parent');
    expect((refusal as VerbRefusal).lines).toEqual(['mode\tyou\tauto-accept-edits', 'mode\tsupervised\tallowed', 'mode\tauto-accept-edits\tallowed']);
});

test('the flag takes a mode by name only', () => {
    expect(modeFlag.parse('auto')).toBe('auto');
    expect(modeFlag.safeParse('root').success).toBe(false);
});
