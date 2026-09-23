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
import type { Editor, EditorEngine, EditorOptions, EditorTheme, MonacoEngineOptions } from './index.ts';
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
        this.editor.onDidChangeModelContent(() => {
            if (!this.settingText) {
                emit(this.changes);
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
        this.editor.dispose();
        this.model.dispose();
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
