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

    test('follows the indentation it is given', () => {
        const engine = new FakeEditorEngine();
        expect(engine.mount(element, { text: '', theme: 'light' }).indentation).toEqual({ tabSize: 4, insertSpaces: true });
        const editor = engine.mount(element, { text: '', theme: 'light', indentation: { tabSize: 2, insertSpaces: false } });
        editor.setIndentation({ tabSize: 8, insertSpaces: true });
        expect(editor.indentation).toEqual({ tabSize: 8, insertSpaces: true });
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

    test('selects a range with the caret at its end', () => {
        const editor = new FakeEditorEngine().mount(element, { text: 'let value = 1;', theme: 'dark' });
        editor.setSelection({ start: { line: 0, character: 4 }, end: { line: 0, character: 9 } });
        expect(editor.getSelection()).toEqual({ start: { line: 0, character: 4 }, end: { line: 0, character: 9 } });
        expect(editor.getCaret()).toEqual({ line: 0, character: 9 });
    });
});

describe('FakeEditor.trackRange', () => {
    const range = (from: number, to: number) => ({ start: { line: 0, character: from }, end: { line: 0, character: to } });

    test('follows an edit before the range and returns null once an edit touches it', () => {
        const editor = new FakeEditorEngine().mount(element, { text: 'alpha beta', theme: 'light' });
        const tracked = editor.trackRange(range(6, 10));
        editor.type('xalpha beta');
        expect(tracked.get()).toEqual(range(7, 11));
        editor.type('xalpha bXta');
        expect(tracked.get()).toBeNull();
    });
});

describe('FakeEditor.setWidgets', () => {
    test('keeps the widgets of each owner apart and answers `widgets` with the default owner', () => {
        const editor = new FakeEditorEngine().mount(element, { text: 'a', theme: 'light' });
        const row = (id: string) => ({ id, line: 0, render: () => undefined });
        editor.setWidgets([row('peek')]);
        editor.setWidgets([row('change')], 'review');
        expect(editor.widgets.map((widget) => widget.id)).toEqual(['peek']);
        expect([...editor.widgetsByOwner.keys()]).toEqual(['default', 'review']);
        editor.setWidgets([], 'review');
        expect([...editor.widgetsByOwner.keys()]).toEqual(['default']);
    });
});
