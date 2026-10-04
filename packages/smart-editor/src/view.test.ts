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
