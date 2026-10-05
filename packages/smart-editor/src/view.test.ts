import { describe, expect, test } from 'bun:test';
import { DocumentModel } from '@ruimte/smart-editor-core';
import { DEFAULT_SMART_KEYS } from './smart-keys.ts';
import { createPage, pointer } from './testing.ts';
import { EditorView, type ViewSettings } from './view.ts';

const SETTINGS: ViewSettings = {
    language: 'typescript',
    tabSize: 4,
    insertSpaces: true,
    readOnly: false,
    readOnlyReason: undefined,
    wrap: false,
    smartKeys: DEFAULT_SMART_KEYS,
    messages: {},
    guides: true,
    whitespace: false,
    rightMargin: null,
    foldOutline: 'hover'
};

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

    test('keeps a fold closed while text is typed above it, before the folds are read again', () => {
        const { host, model, view } = mount(text);
        view.refreshFolds();
        view.toggleFold(0);
        model.applyEdits([{ from: 0, to: 0, text: '// note\n' }]);
        expect(view.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 4 }]);
        expect(rendered(host)).toEqual(['0', '1', '5', '6']);
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

    test('keeps the closing delimiter drawn after the placeholder', () => {
        const { host, view } = mount('function a() {\n    one();\n}, extra\nlast');
        view.refreshFolds();
        view.toggleFold(0);
        const row = host.querySelector('.se-line[data-line="0"]')!;
        const tail = [...row.querySelectorAll('.se-run')].map((run) => run.textContent).at(-1);
        expect(tail).toBe('}, extra');
        expect(row.querySelector('.se-fold-chip')).not.toBeNull();
    });

    test('draws no tail for a fold that has no closer', () => {
        const { host, view } = mount('def a():\n    one\n    two\nb = 1', { language: 'python' });
        view.refreshFolds();
        view.toggleFold(0);
        const runs = [...host.querySelectorAll('.se-line[data-line="0"] .se-run')].map((run) => run.textContent);
        expect(runs).toEqual(['def a():']);
    });

    test('offers one control per line when several ranges start on it, and folds the outermost', () => {
        const source = 'await Promise.all([\n    one(),\n    two()\n]);\nnext();';
        const { host, view } = mount(source);
        view.refreshFolds();
        expect(host.querySelectorAll('.se-fold-toggle').length).toBe(1);
        expect(host.querySelector('.se-fold-toggle')!.textContent).toBe('');
        view.toggleFold(0);
        expect(rendered(host)).toEqual(['0', '4']);
    });

    test('keeps every closer on the last line of a collapsed range, not only the one that closes it', () => {
        const { host, view } = mount('await Promise.all([\n    one(),\n]);\nnext();');
        view.refreshFolds();
        view.toggleFold(0);
        const runs = [...host.querySelectorAll('.se-line[data-line="0"] .se-run')].map((run) => run.textContent);
        expect(runs.at(-1)).toBe(']);');
    });

    test('folds the range around the caret and every range', () => {
        const { host, model, view } = mount(text);
        view.refreshFolds();
        model.setSelections([{ anchor: 20, head: 20 }]);
        view.collapseRegion();
        expect(rendered(host)).toEqual(['0', '4', '5']);
        view.foldAll(false);
        expect(rendered(host)).toEqual(['0', '1', '2', '3', '4', '5']);
        view.foldAll(true);
        expect(rendered(host)).toEqual(['0', '4', '5']);
    });
});

describe('fold commands', () => {
    const nested = 'class A {\n    method() {\n        body();\n    }\n    other() {\n        more();\n    }\n}\nend();';
    const folded = (view: EditorView): { startLine: number; endLine: number }[] => [...view.getFolds().collapsed];

    test('collapse folds the range that starts on the caret line, or else the innermost open one around it', () => {
        const { model, view } = mount(nested);
        view.refreshFolds();
        model.setSelections([{ anchor: model.getLine(2).start + 4, head: model.getLine(2).start + 4 }]);
        view.collapseRegion();
        expect(folded(view)).toEqual([{ startLine: 1, endLine: 3 }]);
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(1).start }]);
        view.collapseRegion();
        expect(folded(view)).toEqual([
            { startLine: 0, endLine: 7 },
            { startLine: 1, endLine: 3 }
        ]);
    });

    test('expand opens the range on the caret line, or else the outermost folded one around it', () => {
        const { model, view } = mount(nested);
        view.refreshFolds();
        view.foldAll(true);
        model.setSelections([{ anchor: 0, head: 0 }]);
        view.expandRegion();
        expect(folded(view).map((fold) => fold.startLine)).toEqual([1, 4]);
    });

    test('collapse and expand recursively take every range inside the one at the caret', () => {
        const { model, view } = mount(nested);
        view.refreshFolds();
        model.setSelections([{ anchor: 0, head: 0 }]);
        view.collapseRecursively();
        expect(folded(view).map((fold) => fold.startLine)).toEqual([0, 1, 4]);
        view.expandRecursively();
        expect(folded(view)).toEqual([]);
    });

    test('fold all and unfold all keep to the selection when it holds ranges', () => {
        const { model, view } = mount(nested);
        view.refreshFolds();
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(3).end }]);
        view.foldAll(true);
        expect(folded(view)).toEqual([{ startLine: 1, endLine: 3 }]);
    });

    test('fold selection folds the lines of the selection, takes the same fold away and follows edits', () => {
        const { host, model, view } = mount('a\nb\nc\nd\ne');
        view.refreshFolds();
        model.setSelections([{ anchor: 2, head: 6 }]);
        view.foldSelection();
        expect(rendered(host)).toEqual(['0', '1', '3', '4']);
        expect(view.getFolds().custom).toEqual([{ startLine: 1, endLine: 2 }]);
        model.applyEdits([{ from: 0, to: 0, text: 'x\n' }]);
        view.refreshFolds();
        expect(view.getFolds().custom).toEqual([{ startLine: 2, endLine: 3 }]);
        model.setSelections([{ anchor: model.getLine(2).start, head: model.getLine(4).start }]);
        view.foldSelection();
        expect(view.getFolds().custom).toEqual([]);
    });

    test('fold selection leaves a selection inside one line alone', () => {
        const { model, view } = mount('abc\ndef');
        view.refreshFolds();
        model.setSelections([{ anchor: 0, head: 2 }]);
        view.foldSelection();
        expect(view.getFolds().custom).toEqual([]);
    });

    test('remembers what is folded and folds it again', () => {
        const { view } = mount(nested);
        view.refreshFolds();
        view.toggleFold(1, true);
        const state = view.getFolds();
        const again = mount(nested);
        again.view.restoreFolds(state);
        expect(again.view.getFolds().collapsed).toEqual([{ startLine: 1, endLine: 3 }]);
    });

    test('folds the roles a host asks for the first time a file opens, and nothing for a file that has folds of its own', () => {
        const source = "import a from 'a';\nimport b from 'b';\n\nconst x = 1;\nfunction f() {\n    return x;\n}\n";
        const { host, view } = mount(source);
        view.restoreFolds(null, ['imports']);
        expect(rendered(host)).toEqual(['0', '2', '3', '4', '5', '6', '7']);
        const second = mount(source);
        second.view.restoreFolds({ collapsed: [], custom: [] }, ['imports']);
        expect(second.host.querySelectorAll('.se-fold-chip')).toHaveLength(0);
        const third = mount(source);
        third.view.restoreFolds(null, []);
        expect(third.host.querySelectorAll('.se-fold-chip')).toHaveLength(0);
    });

    test('folds a region between its markers', () => {
        const { host, view } = mount('// region A\nx();\ny();\n// endregion\nz();');
        view.refreshFolds();
        view.toggleFold(0, true);
        expect(rendered(host)).toEqual(['0', '4']);
    });
});

describe('fold defaults and hints', () => {
    const source = '/**\n * Doc.\n */\nclass A {\n    run() {\n        body();\n    }\n    stop() {\n        more();\n    }\n}\n';
    const runBody = { from: source.indexOf('run()'), to: source.indexOf('    stop') - 1, body: 'method' as const };
    const stopBody = { from: source.indexOf('stop()'), to: source.lastIndexOf('}') - 1, body: 'method' as const };
    const folded = (view: EditorView): number[] => view.getFolds().collapsed.map((fold) => fold.startLine);

    test('folds a role the text gives at once, and one a server names when it answers', () => {
        const { view } = mount(source);
        view.restoreFolds(null, ['doc-comment', 'method-body']);
        expect(folded(view)).toEqual([0]);
        view.setFoldHints({ symbols: [runBody, stopBody] });
        expect(folded(view)).toEqual([0, 4, 7]);
    });

    test('leaves a fold a person opened as it is when the answer comes again', () => {
        const { view } = mount(source);
        view.restoreFolds(null, ['method-body']);
        view.setFoldHints({ symbols: [runBody, stopBody] });
        view.toggleFold(4, false);
        view.setFoldHints({ symbols: [runBody, stopBody] });
        expect(folded(view)).toEqual([7]);
    });

    test('does not fold a range that holds the caret', () => {
        const { model, view } = mount(source);
        model.setSelections([{ anchor: source.indexOf('body()'), head: source.indexOf('body()') }]);
        view.restoreFolds(null, ['method-body']);
        view.setFoldHints({ symbols: [runBody, stopBody] });
        expect(folded(view)).toEqual([7]);
    });

    test('stops folding by itself once the text was edited', () => {
        const { model, view } = mount(source);
        view.restoreFolds(null, ['method-body']);
        model.applyEdits([{ from: 0, to: 0, text: 'x\n' }]);
        view.setFoldHints({ symbols: [{ ...runBody, from: runBody.from + 2, to: runBody.to + 2 }] });
        expect(folded(view)).toEqual([]);
    });

    test('keeps the hints with their text through an edit above them', () => {
        const { model, view } = mount(source);
        view.restoreFolds(null, []);
        view.setFoldHints({ symbols: [runBody] });
        model.applyEdits([{ from: 0, to: 0, text: 'x\n' }]);
        view.refreshFolds();
        expect(view.getFolds().collapsed).toEqual([]);
        view.foldRole('method-body', true);
        expect(folded(view)).toEqual([5]);
    });

    test('folds and opens every documentation comment', () => {
        const { view } = mount(source + '/** Another.\n */\nfunction g() {\n}\n');
        view.refreshFolds();
        view.foldRole('doc-comment', true);
        expect(folded(view)).toEqual([0, 11]);
        view.foldRole('doc-comment', false);
        expect(folded(view)).toEqual([]);
    });

    test('opens every range above a level and folds the ones at it', () => {
        const nested = 'class A {\n    method() {\n        if (a) {\n            b();\n        }\n    }\n}\nend();';
        const { view } = mount(nested);
        view.refreshFolds();
        view.foldAll(true);
        view.expandAllToLevel(1);
        expect(folded(view)).toEqual([1, 2]);
        view.expandAllToLevel(2);
        expect(folded(view)).toEqual([2]);
        view.expandAllToLevel(3);
        expect(folded(view)).toEqual([]);
    });

    test('shows the outline the setting says', () => {
        const { host, view } = mount(source, { foldOutline: 'always' });
        expect(host.querySelector('.se-editor')!.getAttribute('data-fold-outline')).toBe('always');
        view.settings.foldOutline = 'off';
        view.applySettings();
        expect(host.querySelector('.se-editor')!.getAttribute('data-fold-outline')).toBe('off');
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

    test('draws a ghost suggestion after the caret, with its other lines in a row under the line, and drops it on an edit', () => {
        const { host, model, view } = mount('const a = 1;\nreturn a;');
        model.setSelections([{ anchor: 12, head: 12 }]);
        view.setGhost({ at: 12, text: ' // one\n    two\n    three', accessory: (container) => (container.textContent = 'Tab') });
        expect(host.querySelector('.se-ghost')!.textContent).toBe(' // one');
        const rows = [...host.querySelectorAll('.se-ghost-rows .se-code-row')].map((row) => row.textContent);
        expect(rows).toEqual(['    two', '    three']);
        expect(view.layout.rows.map((row) => row.key)).toEqual(['line:0', 'block:__ghost', 'line:1']);
        expect(host.querySelector('.se-line-action')!.textContent).toBe('Tab');
        expect(host.querySelector('.se-ghost-rows.se-widget')).not.toBeNull();
        expect(host.querySelector('.se-line-action.se-ghost-accessory')).not.toBeNull();
        model.applyEdits([{ from: 0, to: 0, text: 'x' }]);
        expect(host.querySelector('.se-ghost')).toBeNull();
        expect(host.querySelector('.se-ghost-rows')).toBeNull();
        expect(host.querySelector('.se-line-action')).toBeNull();
    });

    test('draws a ghost suggestion in front of the stop after it, and takes it away on null', () => {
        const { host, view } = mount('foo');
        const before = view.layout.caret(3, 'after').x;
        view.setGhost({ at: 3, text: '(bar)', accessory: undefined });
        expect(host.querySelector('.se-ghost')).not.toBeNull();
        expect(view.layout.caret(3, 'before').x).toBe(before);
        expect(view.layout.caret(3, 'after').x).toBeGreaterThan(before);
        view.setGhost(null);
        expect(host.querySelector('.se-ghost')).toBeNull();
        expect(view.layout.caret(3, 'after').x).toBe(before);
    });

    test('draws a widget row above a line', () => {
        const { host, view } = mount('a\nb');
        view.setBlockWidgets('test', [{ id: 'w', at: 2, placement: 'above', text: 'hello', height: 30 }]);
        expect(host.querySelector('.se-block')!.textContent).toBe('hello');
        expect(view.layout.rows.map((row) => row.key)).toEqual(['line:0', 'block:w', 'line:1']);
    });

    test('draws a row of the host as wide as the editor, over the gutter', () => {
        const { host, view } = mount('a\nb');
        view.setBlockWidgets('test', [{ id: 'w', at: 2, placement: 'below', height: 30, render: (container) => (container.textContent = 'peek') }]);
        const block = host.querySelector('.se-block') as HTMLElement;
        expect(block.style.left).toBe('-64px');
        expect(block.style.width).toBe('800px');
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

describe('occurrences of the selected text', () => {
    const marks = (host: HTMLElement): number => host.querySelectorAll('.se-occurrence').length;

    test('marks the other places a selection is, softly, in the text and in the scroll track', () => {
        const { host, model, view } = mount('foo bar foo baz Foo');
        model.setSelections([{ anchor: 0, head: 3 }]);
        view.render();
        expect(marks(host)).toBe(2);
        expect(host.querySelectorAll('.se-tick-occurrence').length).toBeGreaterThan(0);
        model.setSelections([{ anchor: 5, head: 5 }]);
        view.render();
        expect(marks(host)).toBe(0);
        expect(host.querySelectorAll('.se-tick-occurrence').length).toBe(0);
    });

    test('leaves out blank text, several lines, several selections and a text that is everywhere', () => {
        const { host, model, view } = mount('a b a\nb a b\n' + 'x '.repeat(60));
        model.setSelections([{ anchor: 1, head: 2 }]);
        view.render();
        expect(marks(host)).toBe(0);
        model.setSelections([{ anchor: 0, head: 8 }]);
        view.render();
        expect(marks(host)).toBe(0);
        model.setSelections([
            { anchor: 0, head: 1 },
            { anchor: 4, head: 5 }
        ]);
        view.render();
        expect(marks(host)).toBe(0);
        model.setSelections([{ anchor: 12, head: 13 }]);
        view.render();
        expect(marks(host)).toBe(0);
        model.setSelections([{ anchor: 0, head: 1 }]);
        view.render();
        expect(marks(host)).toBe(2);
    });
});

describe('indent guides, the right margin, whitespace and wrap signs', () => {
    const source = 'class A {\n    method() {\n        body();\n\n        more();\n    }\n}';
    const lefts = (host: HTMLElement, selector: string): string[] =>
        [...host.querySelectorAll(selector)].map((element) => `${(element as HTMLElement).style.left}/${(element as HTMLElement).style.height}`);

    test('draw a line at each level, through blank lines, and the one of the caret`s scope stronger', () => {
        const { host, model, view } = mount(source);
        model.setSelections([{ anchor: model.getLine(2).start + 9, head: model.getLine(2).start + 9 }]);
        view.render();
        expect(lefts(host, '.se-guide:not(.se-guide-active)')).toEqual(['0px/100px']);
        expect(lefts(host, '.se-guide-active')).toEqual(['31.2px/60px']);
    });

    test('light the guide a line opens or closes, and the scope of a blank line', () => {
        const { host, model, view } = mount(source);
        model.setSelections([{ anchor: model.getLine(1).start, head: model.getLine(1).start }]);
        view.render();
        expect(lefts(host, '.se-guide-active')).toEqual(['31.2px/60px']);
        model.setSelections([{ anchor: model.getLine(6).start, head: model.getLine(6).start }]);
        view.render();
        expect(lefts(host, '.se-guide-active')).toEqual(['0px/100px']);
        model.setSelections([{ anchor: model.getLine(3).start, head: model.getLine(3).start }]);
        view.render();
        expect(lefts(host, '.se-guide-active')).toEqual(['31.2px/60px']);
    });

    test('draw none when they are off, and the margin only when a column is given', () => {
        const off = mount(source, { guides: false });
        expect(off.host.querySelectorAll('.se-guide').length).toBe(0);
        expect(off.host.querySelector('.se-margin')).toBeNull();
        const margin = mount(source, { rightMargin: 80 });
        expect((margin.host.querySelector('.se-margin') as HTMLElement).style.left).toBe('624px');
    });

    test('draw spaces as dots and tabs as arrows when whitespace shows', () => {
        const plain = mount('a b\n\tc');
        expect(plain.host.querySelector('.se-ws')).toBeNull();
        const shown = mount('a b\n\tc', { whitespace: true });
        expect(shown.host.querySelector('.se-ws')!.textContent).toBe('·');
        expect(shown.host.querySelectorAll('.se-tab-sign').length).toBe(1);
    });

    test('draw an arrow where a wrapped row ends and where the next one starts', () => {
        const { host, view } = mount('abcd '.repeat(40).trimEnd(), { wrap: true });
        Object.defineProperty(view.viewport, 'clientWidth', { value: 400 });
        view.applySettings();
        const signs = [...host.querySelectorAll('.se-wrap-sign')].map((sign) => (sign as HTMLElement).style.left);
        expect(signs.length).toBeGreaterThanOrEqual(2);
        expect(signs).toContain('0px');
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

describe('scrolling', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');

    test('draws the rows and the pinned headers in the scroll event itself', () => {
        const { host, view } = mount(`function outer() {\n${text}\n}`);
        view.refreshFolds();
        view.viewport.scrollTop = 20 * 100;
        view.scrolled();
        expect(rendered(host)).toContain('105');
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(1);
    });

    test('keeps a viewport of rows drawn on each side', () => {
        const { host, view } = mount(text);
        view.viewport.scrollTop = 20 * 200;
        view.scrolled();
        const lines = rendered(host).map(Number);
        expect(lines[0]!).toBeLessThanOrEqual(200 - 20);
        expect(lines.at(-1)!).toBeGreaterThanOrEqual(200 + 30);
    });

    test('keeps the pinned headers in the scroll container, where the browser holds them still', () => {
        const { view } = mount(text);
        expect(view.viewport.contains(view.stickyElement)).toBe(true);
    });
});

describe('the primary caret', () => {
    const text = Array.from({ length: 400 }, (_, i) => `line ${i}`).join('\n');

    test('is the one the view scrolls to', () => {
        const { model, view } = mount(text);
        const far = model.getLine(300).start;
        model.setSelections([
            { anchor: 0, head: 0 },
            { anchor: far, head: far }
        ]);
        view.revealCaret();
        expect(view.viewport.scrollTop).toBeGreaterThan(20 * 300 - 400);
    });
});

describe('sticky scroll', () => {
    const body = Array.from({ length: 40 }, (_, i) => `    call(${i});`).join('\n');
    const text = `export function outer() {\n  function inner() {\n${body}\n  }\n}\nconst after = 1;`;

    test('pins the headers of the blocks scrolled out of sight', () => {
        const { host, view } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        expect(host.querySelector('.se-sticky')!.hasAttribute('hidden')).toBe(true);
        viewport.scrollTop = 20 * 20;
        view.render();
        const rows = [...host.querySelectorAll('.se-sticky-row')];
        expect(rows.map((row) => (row as HTMLElement).dataset.line)).toEqual(['0', '1']);
        expect(rows[0]!.querySelector('.se-sticky-number')!.textContent).toBe('1');
        expect(rows[1]!.querySelector('.se-run')!.textContent).toBe('  function inner() {');
    });

    test('goes away again at the top and past the end of the block', () => {
        const { host, view } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        viewport.scrollTop = 20 * 20;
        view.render();
        viewport.scrollTop = 0;
        view.render();
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(0);
        viewport.scrollTop = 20 * 45;
        view.render();
        expect(host.querySelectorAll('.se-sticky-row').length).toBe(0);
    });

    test('pushes the last header up as its block ends', () => {
        const { host, view } = mount(text);
        view.refreshFolds();
        const lineHeight = view.layout.metrics.lineHeight;
        // `inner` ends on line 42; with one header above it, it is pinned at the second row.
        view.viewport.scrollTop = lineHeight * 41 + 10;
        view.render();
        const inner = host.querySelectorAll('.se-sticky-row')[1] as HTMLElement;
        expect(inner.style.transform).toBe('translateY(-10px)');
        expect((host.querySelector('.se-sticky') as HTMLElement).style.height).toBe(`${lineHeight * 2 - 10}px`);
    });

    test('takes the blocks the host hands it over its own reading', () => {
        const { host, view } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        view.setBlocks([{ startLine: 2, endLine: 30, name: 'host' }]);
        viewport.scrollTop = 20 * 20;
        view.render();
        expect([...host.querySelectorAll('.se-sticky-row')].map((row) => (row as HTMLElement).dataset.line)).toEqual(['1']);
    });

    test('jumps to a header and puts the caret on it', () => {
        const { model, view } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        viewport.scrollTop = 20 * 20;
        view.render();
        view.jumpToHeader(1, 1);
        expect(model.positionAt(model.getSelections()[0]!.head)).toMatchObject({ line: 1, column: 2 });
        expect(viewport.scrollTop).toBe(0);
    });

    test('keeps a caret moved up from under the pinned headers', () => {
        const { view, model } = mount(text);
        const viewport = view.viewport;
        view.refreshFolds();
        viewport.scrollTop = 20 * 20;
        view.render();
        const target = model.getLine(21).start;
        view.revealOffset(target);
        expect(viewport.scrollTop).toBeLessThanOrEqual(20 * (21 - 2));
    });
});

describe('the gutter', () => {
    test('scrolls with the text, in the one container, instead of following it from a script', () => {
        const { host, view } = mount('a\nb');
        expect(host.querySelector('.se-viewport .se-scroller > .se-gutter')).not.toBeNull();
        expect(view.gutterElement.parentElement).toBe(host.querySelector('.se-scroller'));
        expect((view.gutterElement.firstElementChild as HTMLElement).style.transform).toBe('');
    });

    test('moves the text right by its own width', () => {
        const { view } = mount('abc');
        view.render();
        expect(view.offsetAtPoint(64, 5)).toBe(0);
        expect(view.offsetAtPoint(64 + 8 * 3, 5)).toBe(3);
    });
});

describe('change marks', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');

    test('draw a bar in the gutter beside each marked line and a triangle for a removal', () => {
        const { host, view } = mount(text);
        view.setChangeMarks([
            { kind: 'added', startLine: 2, endLine: 3 },
            { kind: 'modified', startLine: 5, endLine: 5 },
            { kind: 'deleted', startLine: 8, endLine: 8 },
            { kind: 'deleted', startLine: 2, endLine: 2 }
        ]);
        const marked = [...host.querySelectorAll('.se-line-number')].flatMap((item) => {
            const mark = item.querySelector('.se-change');
            return mark ? [`${item.textContent}:${mark.className.replace('se-change se-change-', '')}`] : [];
        });
        expect(marked).toEqual(['2:added', '3:added', '5:modified', '8:deleted']);
    });

    test('follow their lines through an edit above them', () => {
        const { host, model, view } = mount(text);
        view.setChangeMarks([{ kind: 'modified', startLine: 5, endLine: 5 }]);
        model.applyEdits([{ from: 0, to: 0, text: 'new\nnew\n' }]);
        const marked = [...host.querySelectorAll('.se-line-number')].filter((item) => item.querySelector('.se-change')).map((item) => item.textContent);
        expect(marked).toEqual(['7']);
    });

    test('and the find matches are ticks in the scroll track', () => {
        const { host, view } = mount(text);
        view.setChangeMarks([{ kind: 'added', startLine: 10, endLine: 12 }]);
        view.setFind({ text: 'line 2', caseSensitive: true, wholeWord: false, regex: false }, false);
        view.render();
        const kinds = [...host.querySelectorAll('.se-tick')].map((tick) => tick.className.replace('se-tick se-tick-', ''));
        expect(kinds).toContain('added');
        expect(kinds).toContain('find-current');
        expect(kinds).toContain('find');
    });
});

describe('attribution marks', () => {
    const text = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n');
    const barred = (host: HTMLElement): string[] =>
        [...host.querySelectorAll('.se-line-number')].flatMap((item) => {
            const bar = item.querySelector('.se-attribution') as HTMLElement | null;
            return bar ? [`${item.textContent}:${bar.dataset.attributionId}:${bar.style.background}`] : [];
        });

    test('draw a bar in the gutter on each line of a run, in the color of the mark', () => {
        const { host, view } = mount(text);
        view.setAttributionMarks([
            { id: 'a', startLine: 2, endLine: 3, color: '--agent-1' },
            { id: 'b', startLine: 6, endLine: 6, color: '#c4602f' }
        ]);
        expect(barred(host)).toEqual(['2:a:var(--agent-1)', '3:a:var(--agent-1)', '6:b:#c4602f']);
    });

    test('stand where the change mark of the same line would, and leave a removal', () => {
        const { host, view } = mount(text);
        view.setChangeMarks([
            { kind: 'added', startLine: 2, endLine: 4 },
            { kind: 'deleted', startLine: 6, endLine: 6 },
            { kind: 'modified', startLine: 8, endLine: 8 }
        ]);
        view.setAttributionMarks([
            { id: 'a', startLine: 2, endLine: 3, color: '--agent-1' },
            { id: 'b', startLine: 6, endLine: 6, color: '--agent-1' }
        ]);
        const marks = [...host.querySelectorAll('.se-line-number')].map(
            (item) =>
                `${item.textContent}:${[...item.querySelectorAll('.se-attribution, .se-change')].map((mark) => mark.className.replace('se-change se-change-', 'git-')).join('+')}`
        );
        expect(marks.slice(1, 6)).toEqual(['2:se-attribution', '3:se-attribution', '4:git-added', '5:', '6:se-attribution+git-deleted']);
        expect(marks[7]).toBe('8:git-modified');
    });

    test('follow their lines through an edit above them and are gone once set again', () => {
        const { host, model, view } = mount(text);
        view.setAttributionMarks([{ id: 'a', startLine: 5, endLine: 6, color: '--agent-1' }]);
        model.applyEdits([{ from: 0, to: 0, text: 'new\nnew\n' }]);
        expect(barred(host).map((bar) => bar.split(':')[0])).toEqual(['7', '8']);
        view.setAttributionMarks([]);
        expect(barred(host)).toEqual([]);
    });

    test('report the bar under the pointer and its leaving', () => {
        const { view, window, gutterEdge } = hoverable(text);
        const seen: (string | null)[] = [];
        view.onAttributionHover((hover) => seen.push(hover === null ? null : `${hover.id}:${hover.rect.top}-${hover.rect.bottom}:${hover.rect.right}`));
        view.setAttributionMarks([{ id: 'a', startLine: 2, endLine: 3, color: '--agent-1' }]);
        gutterEdge('pointermove', 1, 2);
        gutterEdge('pointermove', 1, 4);
        gutterEdge('pointermove', 2, 2);
        gutterEdge('pointermove', 2, 20);
        view.gutterElement.dispatchEvent(new (window as unknown as { Event: typeof Event }).Event('pointerleave'));
        expect(seen).toEqual(['a:20-40:64', 'a:40-60:64', null]);
        gutterEdge('pointermove', 1, 6);
        gutterEdge('pointermove', 1, 7);
        expect(seen).toEqual(['a:20-40:64', 'a:40-60:64', null, 'a:20-40:64', null]);
    });

    test('are not hovered once taken away, even under a pointer that has not moved', () => {
        const { view, gutterEdge } = hoverable(text);
        const seen: (string | null)[] = [];
        view.onAttributionHover((hover) => seen.push(hover?.id ?? null));
        view.setAttributionMarks([{ id: 'a', startLine: 2, endLine: 3, color: '--agent-1' }]);
        gutterEdge('pointermove', 1, 2);
        view.setAttributionMarks([]);
        expect(seen).toEqual(['a', null]);
    });
});

function hoverable(text: string) {
    const mounted = mount(text);
    mounted.view.render();
    return {
        ...mounted,
        /* A pointer move in the gutter, `fromEdge` pixels left of the text and `line` rows down, zero-based. */
        gutterEdge: (type: 'pointermove', line: number, fromEdge: number) =>
            pointer(mounted.window, mounted.view.gutterElement, type, 64 - fromEdge, line * 20 + 5)
    };
}

describe('scope', () => {
    test('reports the named blocks around the caret when they change', () => {
        const { model, view } = mount('class A {\n  run() {\n    one();\n  }\n}\nconst x = 1;');
        const seen: string[][] = [];
        view.onScope((scope) => seen.push(scope.map((block) => block.name ?? '')));
        view.refreshFolds();
        model.setSelections([{ anchor: model.getLine(2).start, head: model.getLine(2).start }]);
        model.setSelections([{ anchor: model.getLine(2).start + 1, head: model.getLine(2).start + 1 }]);
        model.setSelections([{ anchor: model.getLine(5).start, head: model.getLine(5).start }]);
        expect(seen).toEqual([['A'], ['A', 'run'], []]);
    });
});

describe('drawing for the host', () => {
    const firstNumber = (host: HTMLElement): Element | null => host.querySelector('.se-line-number');

    test('does not draw again for a setter that has nothing new to say', () => {
        const { host, view } = mount('one\ntwo\nthree');
        view.render();
        let drawn = firstNumber(host);
        const unchanged = (call: () => void): void => {
            call();
            expect(firstNumber(host)).toBe(drawn);
        };
        const changed = (call: () => void): void => {
            call();
            expect(firstNumber(host)).not.toBe(drawn);
            drawn = firstNumber(host);
        };
        unchanged(() => view.setGutterAction(null));
        changed(() => view.setGutterAction({ line: 1, label: 'Show' }));
        unchanged(() => view.setGutterAction({ line: 1, label: 'Show' }));
        changed(() => view.setGutterAction(null));
        unchanged(() => view.setGutterMarkers('inline', []));
        changed(() => view.setGutterMarkers('inline', [{ id: 'a', line: 0, label: 'Open' }]));
        unchanged(() => view.setGutterMarkers('inline', [{ id: 'a', line: 0, label: 'Open' }]));
        changed(() => view.setGutterMarkers('inline', [{ id: 'a', line: 2, label: 'Open' }]));
        unchanged(() => view.setLineActions('ghost', []));
        unchanged(() => view.setOccurrences([]));
    });

    test('reads the size and scroll of the viewport once for a draw, however much it draws', () => {
        const { host, view } = mount('one\ntwo\nthree');
        view.render();
        const viewport = host.querySelector('.se-viewport') as HTMLElement;
        const reads: Record<string, number> = { clientWidth: 0, clientHeight: 0, scrollTop: 0, scrollLeft: 0 };
        for (const name of Object.keys(reads)) {
            Object.defineProperty(viewport, name, {
                get: () => {
                    reads[name]!++;
                    return 0;
                },
                set: () => undefined,
                configurable: true
            });
        }
        view.setGutterAction({ line: 0, label: 'Show' });
        expect(reads).toEqual({ clientWidth: 1, clientHeight: 1, scrollTop: 1, scrollLeft: 1 });
    });
});
