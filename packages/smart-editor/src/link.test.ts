import { describe, expect, test } from 'bun:test';
import { mountEditor } from './testing.ts';

const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

describe('setLink', () => {
    test('underlines a range with the pointer on it, until it is taken away or the text is edited', () => {
        const { editor, page } = mountEditor({ text: 'let value = 1;' });
        const { host } = page;
        editor.setLink(range(0, 4, 9));
        expect(host.querySelectorAll('.se-link')).toHaveLength(1);
        expect(host.querySelector('.se-content-link')).not.toBeNull();
        editor.setLink(null);
        expect(host.querySelectorAll('.se-link')).toHaveLength(0);
        expect(host.querySelector('.se-content-link')).toBeNull();
        editor.setLink(range(0, 4, 9));
        editor.setText('let other = 1;');
        editor.applyEdits([{ range: range(0, 0, 0), text: ' ' }]);
        expect(host.querySelectorAll('.se-link')).toHaveLength(0);
        editor.dispose();
    });
});
