import { describe, expect, test } from 'bun:test';
import { inkOn } from '@/extensions/ink';

describe('the ink on an extension color', () => {
    test('is light on a dark color and dark on a bright one', () => {
        expect(inkOn('#1d4ed8')).toBe('#ffffff');
        expect(inkOn('#fde047')).toBe('#111114');
    });
});
