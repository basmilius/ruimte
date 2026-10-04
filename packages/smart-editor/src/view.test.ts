import { describe, expect, test } from 'bun:test';
import { DocumentModel } from '@ruimte/smart-editor-core';
import { createPage } from './testing.ts';
import { EditorView, type ViewSettings } from './view.ts';

const SETTINGS: ViewSettings = { language: 'typescript', tabSize: 4, insertSpaces: true, readOnly: false, readOnlyReason: undefined, wrap: false };

function mount(text: string, settings: Partial<ViewSettings> = {}) {
    const page = createPage();
    const model = new DocumentModel(text);
    const view = new EditorView(page.host, model, { ...SETTINGS, ...settings });
    return { ...page, model, view };
}

const rendered = (host: HTMLElement): string[] =>
    [...host.querySelectorAll('.se-line')].map((line) => (line as HTMLElement).dataset.line!).sort((left, right) => Number(left) - Number(right));

describe('folding', () => {
    const text = 'function a() {\n    one();\n    two();\n}\nconst b = 1;\n';

    test('offers a control on the first line of each range', () => {
        const { host, view } = mount(text);
        view.refreshFolds();
        expect([...host.querySelectorAll('.se-fold-toggle')].map((button) => (button as HTMLElement).dataset.foldLine)).toEqual(['0']);
    });

    test('hides the lines of a collapsed range and shows a chip in their place', () => {
        const { host, view } = mount(text);
        view.refreshFolds();
        expect(view.toggleFold(0)).toBe(true);
        expect(rendered(host)).toEqual(['0', '4', '5']);
        expect(host.querySelector('.se-fold-chip')).not.toBeNull();
        expect(host.querySelector('.se-fold-toggle')!.className).toContain('se-folded');
        view.toggleFold(0);
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '4', '5']);
    });

    test('has nothing to fold on a line that starts no range', () => {
        const { view } = mount(text);
        view.refreshFolds();
        expect(view.toggleFold(4)).toBe(false);
    });

    test('moves a caret out of the lines it hides', () => {
        const { model, view } = mount(text);
        view.refreshFolds();
        model.setSelections([{ anchor: 22, head: 22 }]);
        view.toggleFold(0);
        expect(model.getSelections()[0]).toEqual({ anchor: 14, head: 14 });
    });

    test('opens a fold again for an offset inside it', () => {
        const { host, model, view } = mount(text);
        view.refreshFolds();
        view.toggleFold(0);
        view.revealOffset(model.getText().indexOf('two'));
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '4', '5']);
    });

    test('keeps a fold shut when text above it changes', () => {
        const { host, model, view } = mount('x\n' + text);
        view.refreshFolds();
        view.toggleFold(1);
        model.applyEdits([{ from: 0, to: 0, text: 'yy\nzz\n' }]);
        view.refreshFolds();
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '7', '8']);
    });

    test('folds the range around the caret and every range', () => {
        const { host, model, view } = mount(text);
        view.refreshFolds();
        model.setSelections([{ anchor: 20, head: 20 }]);
        view.foldAround(true, false);
        expect(rendered(host)).toEqual(['0', '4', '5']);
        view.foldAround(false, true);
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '4', '5']);
    });
});

describe('inlays and widgets', () => {
    test('draws an inlay between two characters and keeps it at its character through edits', () => {
        const { host, model, view } = mount('foo(bar)');
        view.setInlays([{ id: 'hint', at: 4, text: 'name:' }]);
        expect(host.querySelector('.se-inlay')!.textContent).toBe('name:');
        model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
        expect(view.layout.geometry(view.layout.rows[0] as never).inlays[0]!.inlay.at).toBe(5);
    });

    test('draws a widget row above a line', () => {
        const { host, view } = mount('a\nb');
        view.setBlockWidgets([{ id: 'w', at: 2, placement: 'above', text: 'hello', height: 30 }]);
        expect(host.querySelector('.se-block')!.textContent).toBe('hello');
        expect(view.layout.rows.map((row) => row.key)).toEqual(['line:0', 'block:w', 'line:1']);
    });

    test('marks occurrences the host asks for and drops them on an edit', () => {
        const { host, model, view } = mount('ab ab');
        view.setOccurrences([
            { from: 0, to: 2 },
            { from: 3, to: 5 }
        ]);
        expect(host.querySelectorAll('.se-occurrence').length).toBe(2);
        model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
        expect(host.querySelectorAll('.se-occurrence').length).toBe(0);
    });
});

describe('brackets', () => {
    test('marks a bracket at the caret and its mate', () => {
        const { host, model } = mount('f(a)');
        model.setSelections([{ anchor: 2, head: 2 }]);
        expect(host.querySelectorAll('.se-bracket-match').length).toBe(2);
    });

    test('marks a bracket that has none', () => {
        const { host, model } = mount('f(a');
        model.setSelections([{ anchor: 2, head: 2 }]);
        expect(host.querySelectorAll('.se-bracket-unmatched').length).toBe(1);
    });
});

describe('the notice', () => {
    test('shows a message and takes it away on dispose', () => {
        const { host, view } = mount('a');
        view.notify('Read only');
        expect(host.querySelector('.se-notice')!.textContent).toBe('Read only');
        view.dispose();
        expect(host.querySelector('.se-editor')).toBeNull();
    });
});
