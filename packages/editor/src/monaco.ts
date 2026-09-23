import * as monaco from 'monaco-editor/editor';
// The editing a person expects of any text box, and the icon font the find bar draws with; nothing here needs a language service.
import 'monaco-editor/features/codicon/register';
import 'monaco-editor/features/find/register';
import 'monaco-editor/features/linesOperations/register';
import 'monaco-editor/features/multicursor/register';
import 'monaco-editor/features/wordOperations/register';
import type { Highlighter } from 'shiki';
import { readChromeColors, readEditorFont } from './chrome.ts';
import type { Editor, EditorEngine, EditorOptions, EditorTheme } from './index.ts';
import { emit, type Listener, subscribe } from './listeners.ts';
import { monacoTheme, PLAIN_TEXT, SHIKI_THEMES, ShikiBridge, type ShikiTheme } from './shiki-bridge.ts';

const SHIKI_THEME: Readonly<Record<EditorTheme, ShikiTheme>> = { light: 'github-light', dark: 'github-dark' };

class MonacoEngine implements EditorEngine {
    private readonly highlighter: Highlighter;
    private readonly bridge: ShikiBridge;

    constructor(highlighter: Highlighter, bridge: ShikiBridge) {
        this.highlighter = highlighter;
        this.bridge = bridge;
    }

    mount(element: HTMLElement, options: EditorOptions): Editor {
        return new MonacoEditor(this, element, options);
    }

    /* Monaco has one theme for the page, so this repaints every editor, which all follow the app's theme anyway. */
    applyTheme(element: HTMLElement, theme: EditorTheme): void {
        const name = SHIKI_THEME[theme];
        const base = monacoTheme(this.highlighter, name);
        monaco.editor.defineTheme(name, { ...base, colors: { ...base.colors, ...readChromeColors(element) } });
        this.bridge.setTheme(name);
        monaco.editor.setTheme(name);
    }

    language(id: string | undefined): Promise<string> {
        return this.bridge.language(id);
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
        this.model = monaco.editor.createModel(options.text, PLAIN_TEXT);
        engine.applyTheme(element, options.theme);
        this.editor = monaco.editor.create(element, {
            model: this.model,
            readOnly: options.readOnly ?? false,
            wordWrap: options.wrap === true ? 'on' : 'off',
            automaticLayout: true,
            minimap: { enabled: false },
            scrollBeyondLastLine: false,
            ...readEditorFont(element),
            // The folding feature is not loaded, and the gutter would keep its room anyway.
            folding: false,
            // So the text starts about where the viewer's does, after 48px of line numbers and 16px beside them.
            lineNumbersMinChars: 6,
            lineDecorationsWidth: 16,
            // The client tells typing from a shortcut by a textarea or contenteditable target; an EditContext host is neither.
            editContext: false
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
            this.revealLine(options.line);
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
        if (text === this.model.getValue()) {
            return;
        }
        this.settingText = true;
        try {
            this.model.setValue(text);
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
        const lineNumber = Math.min(Math.max(1, line), this.model.getLineCount());
        this.editor.setPosition({ lineNumber, column: 1 });
        this.editor.revealLineInCenter(lineNumber);
    }

    setTheme(theme: EditorTheme): void {
        this.engine.applyTheme(this.element, theme);
    }

    setReadOnly(readOnly: boolean): void {
        this.editor.updateOptions({ readOnly });
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
}

export const createMonacoEngine = async (source: () => Promise<Highlighter>): Promise<EditorEngine> => {
    const highlighter = await source();
    await highlighter.loadTheme(...SHIKI_THEMES);
    // Monaco would otherwise resolve its worker by a path of its own, which no bundler follows.
    globalThis.MonacoEnvironment = {
        getWorker: () => new Worker(new URL('./editor.worker.ts', import.meta.url), { type: 'module', name: 'monaco-editor' })
    };
    return new MonacoEngine(highlighter, new ShikiBridge(highlighter, monaco.languages, SHIKI_THEME.light));
};
