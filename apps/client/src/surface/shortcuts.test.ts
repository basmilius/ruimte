import { describe, expect, test } from 'bun:test';
import { shortcut } from '@adecore/ui';
import { CANVAS_SHORTCUTS } from '@/surface/canvas/shortcuts';
import { BROWSER_KEEPS } from './shortcuts';

describe('the keys a browser tab keeps', () => {
    test('hold Unwrap/Remove, since a browser opens Clear Browsing Data on it', () => {
        expect(BROWSER_KEEPS).toContainEqual(shortcut('Mod+Shift+Delete'));
        expect(BROWSER_KEEPS).toContainEqual(CANVAS_SHORTCUTS.unwrap);
    });
});
