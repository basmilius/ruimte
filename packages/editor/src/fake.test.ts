import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from './fake.ts';

const element = {} as HTMLElement;

describe('FakeEditorEngine', () => {
    test('mounts an editor with the options it was given', () => {
        const engine = new FakeEditorEngine();
        const editor = engine.mount(element, {
            text: 'a\nb',
            language: 'typescript',
            path: '/repo/src/a.tsx',
            theme: 'dark',
            line: 2,
            column: 3,
            scrollTop: 40
        });
        expect(engine.last).toBe(editor);
        expect(editor.getText()).toBe('a\nb');
        expect(editor.language).toBe('typescript');
        expect(editor.path).toBe('/repo/src/a.tsx');
        expect(editor.theme).toBe('dark');
        expect(editor.revealedLine).toBe(2);
        expect(editor.column).toBe(3);
        expect(editor.scrollTop).toBe(40);
        expect(editor.readOnly).toBe(false);
        expect(editor.wrap).toBe(false);
    });

    test('follows the wrap it is set to', () => {
        const editor = new FakeEditorEngine().mount(element, { text: '', theme: 'light', wrap: true });
        editor.setWrap(false);
        expect(editor.wrap).toBe(false);
    });

    test('reports a typed change and never one set from outside', () => {
        const editor = new FakeEditorEngine().mount(element, { text: 'a', theme: 'light' });
        let changes = 0;
        editor.onChange(() => {
            changes += 1;
        });
        editor.type('ab');
        editor.setText('reloaded');
        expect(changes).toBe(1);
        expect(editor.getText()).toBe('reloaded');
    });

    test('refuses typing while read-only', () => {
        const editor = new FakeEditorEngine().mount(element, { text: 'a', theme: 'light', readOnly: true, readOnlyReason: 'Zoom in to edit' });
        expect(editor.readOnlyReason).toBe('Zoom in to edit');
        let changes = 0;
        editor.onChange(() => {
            changes += 1;
        });
        editor.type('b');
        editor.setReadOnly(false);
        expect(editor.readOnlyReason).toBeUndefined();
        editor.type('c');
        expect(changes).toBe(1);
        expect(editor.getText()).toBe('c');
    });

    test('fires save and blur to whoever still listens', () => {
        const editor = new FakeEditorEngine().mount(element, { text: '', theme: 'light' });
        const heard: string[] = [];
        const stopSaving = editor.onSave(() => heard.push('save'));
        editor.onBlur(() => heard.push('blur'));
        editor.focus();
        editor.save();
        editor.blur();
        stopSaving();
        editor.save();
        expect(heard).toEqual(['save', 'blur']);
        expect(editor.focused).toBe(false);
    });

    test('refuses to be driven after it is disposed', () => {
        const editor = new FakeEditorEngine().mount(element, { text: '', theme: 'light' });
        editor.dispose();
        expect(editor.disposed).toBe(true);
        expect(() => editor.type('a')).toThrow('The editor is disposed');
    });
});
