import * as monaco from 'monaco-editor/editor';
/*
 * Every editor feature, and not a few picked ones: the language services load all of them with their
 * workers anyway, and an editor only takes the features registered before it was made, so a pick would
 * leave the editors opened before the first service with less than those after it. What does not fit
 * the app is turned off in the options below.
 */
import 'monaco-editor/features/register.all';
import type { Highlighter } from 'shiki';
import { readChromeColors, readEditorFont } from './chrome.ts';
import type { Editor, EditorEngine, EditorFindQuery, EditorFindState, EditorOptions, EditorTheme, MonacoEngineOptions } from './index.ts';
import { monacoKeyOf } from './keys.ts';
import { modelPath, type WorkerKind, workerFor } from './languages.ts';
import { emit, type Listener, subscribe } from './listeners.ts';
import { configureLanguageServices } from './services.ts';
import { monacoTheme, PLAIN_TEXT, ShikiBridge } from './shiki-bridge.ts';
import { changedSpan } from './text-span.ts';

// Each a literal `new Worker(new URL(...))`, which is the form a bundler follows into a worker of its own.
const WORKERS: Readonly<Record<WorkerKind, () => Worker>> = {
    editor: () => new Worker(new URL('./editor.worker.ts', import.meta.url), { type: 'module', name: 'monaco-editor' }),
    typescript: () => new Worker(new URL('./ts.worker.ts', import.meta.url), { type: 'module', name: 'monaco-typescript' }),
    css: () => new Worker(new URL('./css.worker.ts', import.meta.url), { type: 'module', name: 'monaco-css' }),
    json: () => new Worker(new URL('./json.worker.ts', import.meta.url), { type: 'module', name: 'monaco-json' }),
    html: () => new Worker(new URL('./html.worker.ts', import.meta.url), { type: 'module', name: 'monaco-html' })
};

let models = 0;

// Monaco's own separators, so a whole word in the bar is the word a double click selects.
const WORD_SEPARATORS = '`~!@#$%^&*()-=+[{]}\\|;:\'",.<>/?';
// Past this a count means nothing to a reader, and marking every match would stall the editor.
const FIND_LIMIT = 10000;
const FIND_RULER = { color: { id: 'editorOverviewRuler.findMatchForeground' }, position: monaco.editor.OverviewRulerLane.Center };
const FIND_MATCH: monaco.editor.IModelDecorationOptions = {
    className: 'find-hit',
    stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
    overviewRuler: FIND_RULER
};
const FIND_CURRENT: monaco.editor.IModelDecorationOptions = {
    ...FIND_MATCH,
    className: 'find-hit-current',
    inlineClassName: 'find-hit-current-text',
    zIndex: 1
};

/* Without a reason Monaco answers typing in a read-only editor with a sentence of its own, in English. */
const readOnlyOptions = (readOnly: boolean, reason: string | undefined): monaco.editor.IEditorOptions => ({
    readOnly,
    ...(reason === undefined ? {} : { readOnlyMessage: { value: reason } })
});

class MonacoEngine implements EditorEngine {
    private readonly highlighter: Highlighter;
    private bridge: ShikiBridge | null = null;
    private requested: EditorTheme | null = null;
    // Settles once the theme asked for last is painted, so a grammar is never built for the one before it.
    private painted: Promise<void> = Promise.resolve();

    constructor(highlighter: Highlighter) {
        this.highlighter = highlighter;
    }

    mount(element: HTMLElement, options: EditorOptions): Editor {
        return new MonacoEditor(this, element, options);
    }

    /* Monaco has one theme for the page, so this repaints every editor, which all follow the one code theme anyway. */
    applyTheme(element: HTMLElement, theme: EditorTheme): void {
        this.requested = theme;
        if (this.highlighter.getLoadedThemes().includes(theme)) {
            this.paint(element, theme);
            return;
        }
        this.painted = this.highlighter
            .loadTheme(theme as Parameters<Highlighter['loadTheme']>[0])
            .then(() => {
                if (this.requested === theme) {
                    this.paint(element, theme);
                }
            })
            .catch(() => undefined);
    }

    async language(id: string | undefined): Promise<string> {
        await this.painted;
        return this.bridge === null ? PLAIN_TEXT : this.bridge.language(id);
    }

    private paint(element: HTMLElement, theme: EditorTheme): void {
        const base = monacoTheme(this.highlighter, theme);
        monaco.editor.defineTheme(theme, { ...base, colors: { ...base.colors, ...readChromeColors(element) } });
        this.bridge ??= new ShikiBridge(this.highlighter, monaco.languages, theme);
        this.bridge.setTheme(theme);
        monaco.editor.setTheme(theme);
    }
}

class MonacoEditor implements Editor {
    private readonly engine: MonacoEngine;
    private readonly element: HTMLElement;
    private readonly model: monaco.editor.ITextModel;
    private readonly editor: monaco.editor.IStandaloneCodeEditor;
    private readonly changes = new Set<Listener>();
    private readonly saves = new Set<Listener>();
    private readonly blurs = new Set<Listener>();
    private readonly finds = new Set<(state: EditorFindState) => void>();
    private readonly findMarks: monaco.editor.IEditorDecorationsCollection;
    private findQuery: EditorFindQuery | null = null;
    private findMatches: monaco.Range[] = [];
    private findCurrent: number | null = null;
    private settingText = false;
    private disposed = false;

    constructor(engine: MonacoEngine, element: HTMLElement, options: EditorOptions) {
        this.engine = engine;
        this.element = element;
        models += 1;
        this.model = monaco.editor.createModel(options.text, PLAIN_TEXT, monaco.Uri.from({ scheme: 'inmemory', path: modelPath(models, options.path) }));
        engine.applyTheme(element, options.theme);
        this.editor = monaco.editor.create(element, {
            model: this.model,
            ...readOnlyOptions(options.readOnly ?? false, options.readOnlyReason),
            wordWrap: options.wrap === true ? 'on' : 'off',
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            ...readEditorFont(element),
            // The gutter would keep room for it, so the text would no longer start where the viewer's does.
            folding: false,
            // The node or the panel around the editor owns the right-click.
            contextmenu: false,
            // Monaco would open a link in a window of its own.
            links: false,
            // It would lay a header of its own over the first lines, which the viewer never draws.
            stickyScroll: { enabled: false },
            // So the text starts about where the viewer's does, after 48px of line numbers and 16px beside them.
            lineNumbersMinChars: 6,
            lineDecorationsWidth: 16,
            // The client tells typing from a shortcut by a textarea or contenteditable target; an EditContext host is neither.
            editContext: false,
            quickSuggestions: { other: 'on', comments: 'off', strings: 'off' },
            wordBasedSuggestions: 'matchingDocuments'
        });
        this.findMarks = this.editor.createDecorationsCollection();
        this.editor.onDidChangeModelContent(() => {
            if (!this.settingText) {
                emit(this.changes);
            }
            if (this.findQuery !== null) {
                this.search(false);
            }
        });
        this.editor.onDidBlurEditorWidget(() => emit(this.blurs));
        // An action and not `addCommand`: a command's keybinding is global and would fire in the editor created last.
        this.editor.addAction({
            id: 'ruimte.save',
            label: 'Save',
            keybindings: [monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyS],
            run: () => emit(this.saves)
        });
        if (options.line !== undefined) {
            const lineNumber = this.clampLine(options.line);
            this.editor.setPosition({ lineNumber, column: Math.max(1, options.column ?? 1) });
            if (options.scrollTop === undefined) {
                this.editor.revealLineInCenter(lineNumber);
            }
        }
        if (options.scrollTop !== undefined) {
            this.editor.setScrollTop(options.scrollTop);
        }
        void engine.language(options.language).then((language) => {
            if (!this.disposed && language !== PLAIN_TEXT) {
                monaco.editor.setModelLanguage(this.model, language);
            }
        });
    }

    getText(): string {
        return this.model.getValue();
    }

    setText(text: string): void {
        const span = changedSpan(this.model.getValue(), text);
        if (span === null) {
            return;
        }
        const start = this.model.getPositionAt(span.start);
        const end = this.model.getPositionAt(span.end);
        this.settingText = true;
        try {
            // An edit and not `setValue`, which would drop the undo history and put the cursor on line one.
            this.model.pushStackElement();
            this.model.pushEditOperations(
                [],
                [{ range: new monaco.Range(start.lineNumber, start.column, end.lineNumber, end.column), text: span.text }],
                () => null
            );
            this.model.pushStackElement();
        } finally {
            this.settingText = false;
        }
    }

    onChange(listener: Listener): () => void {
        return subscribe(this.changes, listener);
    }

    onSave(listener: Listener): () => void {
        return subscribe(this.saves, listener);
    }

    onBlur(listener: Listener): () => void {
        return subscribe(this.blurs, listener);
    }

    revealLine(line: number): void {
        const lineNumber = this.clampLine(line);
        this.editor.setPosition({ lineNumber, column: 1 });
        this.editor.revealLineInCenter(lineNumber);
    }

    find(query: EditorFindQuery | null): void {
        this.findQuery = query === null || query.text === '' ? null : query;
        this.search(true);
    }

    findStep(direction: 1 | -1): void {
        const count = this.findMatches.length;
        if (count === 0) {
            return;
        }
        this.findCurrent = this.findCurrent === null ? (direction === 1 ? 0 : count - 1) : (this.findCurrent + direction + count) % count;
        this.paintFind(true);
    }

    onFind(listener: (state: EditorFindState) => void): () => void {
        this.finds.add(listener);
        return () => {
            this.finds.delete(listener);
        };
    }

    endFind(): void {
        const range = this.findCurrent === null ? null : this.findMatches[this.findCurrent];
        if (range) {
            this.editor.setSelection(range);
        }
        this.find(null);
    }

    setWrap(wrap: boolean): void {
        this.editor.updateOptions({ wordWrap: wrap ? 'on' : 'off' });
    }

    setTheme(theme: EditorTheme): void {
        this.engine.applyTheme(this.element, theme);
    }

    setReadOnly(readOnly: boolean, reason?: string): void {
        this.editor.updateOptions(readOnlyOptions(readOnly, reason));
    }

    focus(): void {
        this.editor.focus();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.changes.clear();
        this.saves.clear();
        this.blurs.clear();
        this.finds.clear();
        this.editor.dispose();
        this.model.dispose();
    }

    /*
     * The matches again, after a new query or an edit. A new query moves to the first match from the
     * one it was on, or from the cursor, so each letter typed keeps the place instead of starting over;
     * an edit keeps the place and leaves the view alone.
     */
    private search(move: boolean): void {
        const query = this.findQuery;
        const previous = this.findCurrent === null ? null : (this.findMatches[this.findCurrent] ?? null);
        if (query === null) {
            this.findMatches = [];
            this.findCurrent = null;
            this.paintFind(false);
            return;
        }
        let found: monaco.editor.FindMatch[] = [];
        try {
            found = this.model.findMatches(query.text, false, query.regex, query.caseSensitive, query.wholeWord ? WORD_SEPARATORS : null, false, FIND_LIMIT);
        } catch {
            // A pattern Monaco cannot read finds nothing; the bar says it is invalid.
        }
        this.findMatches = found.map((match) => match.range);
        const anchor = previous?.getStartPosition() ?? this.editor.getSelection()?.getStartPosition() ?? null;
        const next = anchor === null ? -1 : this.findMatches.findIndex((range) => !range.getStartPosition().isBefore(anchor));
        this.findCurrent = this.findMatches.length === 0 ? null : Math.max(0, next);
        this.paintFind(move);
    }

    private paintFind(reveal: boolean): void {
        const current = this.findCurrent;
        this.findMarks.set(this.findMatches.map((range, index) => ({ range, options: index === current ? FIND_CURRENT : FIND_MATCH })));
        const range = current === null ? undefined : this.findMatches[current];
        if (reveal && range) {
            this.editor.revealRangeInCenterIfOutsideViewport(range, monaco.editor.ScrollType.Smooth);
        }
        const state: EditorFindState = { count: this.findMatches.length, current };
        for (const listener of [...this.finds]) {
            listener(state);
        }
    }

    private clampLine(line: number): number {
        return Math.min(Math.max(1, line), this.model.getLineCount());
    }
}

/* A rule without a command makes Monaco pass the key on, where the window's own listeners hear it. */
const handBackKeys = ({ handBack = [], apple = false }: MonacoEngineOptions): void => {
    monaco.editor.addKeybindingRules(
        handBack.flatMap((chord) => {
            const key = monacoKeyOf(chord, apple);
            if (key === null) {
                return [];
            }
            return [{ keybinding: key.modifiers.reduce((sum, modifier) => sum | monaco.KeyMod[modifier], monaco.KeyCode[key.code]), command: null }];
        })
    );
};

export const createMonacoEngine = async (options: MonacoEngineOptions): Promise<EditorEngine> => {
    const highlighter = await options.highlighter();
    // Monaco would otherwise resolve its workers by paths of its own, which no bundler follows.
    globalThis.MonacoEnvironment = { getWorker: (_workerId: string, label: string) => WORKERS[workerFor(label)]() };
    configureLanguageServices();
    handBackKeys(options);
    return new MonacoEngine(highlighter);
};
