import { DocumentModel, replacementText } from '@ruimte/smart-editor-core';
import { InputController } from './controller.ts';
import { emit, type Listener, subscribe } from './listeners.ts';
import { changedSpan } from './text-span.ts';
import type {
    Editor,
    EditorBlock,
    EditorChangeMark,
    EditorEngine,
    EditorFindQuery,
    EditorIndentation,
    EditorFindState,
    EditorOptions,
    EditorTheme,
    SmartEditorEngineOptions
} from './types.ts';
import { EditorView, type ViewSettings } from './view.ts';

const DEFAULT_TAB_SIZE = 4;

class SmartEditor implements Editor {
    private readonly model: DocumentModel;
    private readonly settings: ViewSettings;
    private readonly view: EditorView;
    private readonly controller: InputController;
    private readonly changes = new Set<Listener>();
    private readonly saves = new Set<Listener>();
    private readonly blurs = new Set<Listener>();
    private readonly subscription: { dispose(): void };
    private language: string | undefined;
    private theme: EditorTheme;
    private revision: number;
    private tokenizerRequest = 0;
    private settingText = false;
    private disposed = false;

    private readonly engine: SmartEditorEngineOptions;

    constructor(engine: SmartEditorEngineOptions, element: HTMLElement, options: EditorOptions) {
        this.engine = engine;
        this.model = new DocumentModel(options.text);
        this.language = options.language;
        this.theme = options.theme;
        this.settings = {
            language: options.language,
            tabSize: options.indentation?.tabSize ?? DEFAULT_TAB_SIZE,
            insertSpaces: options.indentation?.insertSpaces ?? true,
            readOnly: options.readOnly ?? false,
            readOnlyReason: options.readOnlyReason,
            wrap: options.wrap ?? false
        };
        this.view = new EditorView(element, this.model, this.settings);
        this.controller = new InputController(this.view, {
            handBack: engine.handBack ?? [],
            apple: engine.apple ?? false,
            save: () => emit(this.saves),
            blur: () => emit(this.blurs)
        });
        this.revision = this.model.getRevision();
        this.subscription = this.model.subscribe((snapshot) => {
            if (snapshot.revision !== this.revision) {
                this.revision = snapshot.revision;
                if (!this.settingText) {
                    emit(this.changes);
                }
            }
        });
        this.loadTokenizer();
        this.placeCursor(options);
    }

    /* Where the editor opens: on a line and column, scrolled to a position, or with that line in view. */
    private placeCursor(options: EditorOptions): void {
        if (options.line !== undefined) {
            const line = this.clampLine(options.line);
            const bounds = this.model.getLine(line);
            const offset = Math.min(bounds.end, bounds.start + Math.max(0, (options.column ?? 1) - 1));
            this.model.setSelections([{ anchor: offset, head: offset }]);
            if (options.scrollTop === undefined) {
                this.view.revealOffset(offset, true);
            }
        }
        if (options.scrollTop !== undefined) {
            this.view.render();
            this.view.viewport.scrollTop = options.scrollTop;
            this.view.render();
        }
    }

    private loadTokenizer(): void {
        const request = ++this.tokenizerRequest;
        void this.engine
            .tokenizer(this.language, this.theme)
            .catch(() => null)
            .then((tokenizer) => {
                if (!this.disposed && request === this.tokenizerRequest) {
                    this.view.setTokenizer(tokenizer);
                }
            });
    }

    getText(): string {
        return this.model.getText();
    }

    setText(text: string): void {
        const span = changedSpan(this.model.getText(), text);
        if (span === null) {
            return;
        }
        this.settingText = true;
        try {
            // An edit and not a reset, which would drop the undo history and put the cursor on line one.
            this.model.applyEdits([{ from: span.start, to: span.end, text: span.text }], { source: 'external' });
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
        const bounds = this.model.getLine(this.clampLine(line));
        this.model.setSelections([{ anchor: bounds.start, head: bounds.start }]);
        this.view.revealOffset(bounds.start, true);
    }

    find(query: EditorFindQuery | null): void {
        this.view.setFind(query, true);
    }

    findStep(direction: 1 | -1): void {
        this.view.stepFind(direction);
    }

    replace(replacement: string): boolean {
        const { find } = this.view;
        const mark = find.currentMark;
        const query = find.activeQuery;
        if (mark === null || query === null || this.blockedByReadOnly()) {
            return false;
        }
        try {
            const options = { caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regex: query.regex, from: mark.from, to: mark.to, maxResults: 1 };
            const match = this.model.find(query.text, options)[0];
            if (match === undefined) {
                return false;
            }
            // The next match is looked for after what was written, or a replacement that holds the query would find itself again.
            find.pendingAnchor = mark.from + replacementText(this.model.getText(), match, replacement).length;
            if (!this.model.replace(match, replacement)) {
                find.pendingAnchor = undefined;
                return false;
            }
        } catch {
            find.pendingAnchor = undefined;
            return false;
        }
        this.view.revealFind();
        this.view.render();
        return true;
    }

    replaceAll(replacement: string): number {
        const query = this.view.find.activeQuery;
        if (query === null || this.blockedByReadOnly()) {
            return 0;
        }
        try {
            return this.model.replaceAll(query.text, replacement, { caseSensitive: query.caseSensitive, wholeWord: query.wholeWord, regex: query.regex });
        } catch {
            return 0;
        }
    }

    private blockedByReadOnly(): boolean {
        if (!this.settings.readOnly) {
            return false;
        }
        if (this.settings.readOnlyReason) {
            this.view.notify(this.settings.readOnlyReason);
        }
        return true;
    }

    onFind(listener: (state: EditorFindState) => void): () => void {
        return this.view.onFind(listener);
    }

    endFind(): void {
        const mark = this.view.find.currentMark;
        this.view.setFind(null, false);
        if (mark) {
            this.view.ensureVisible(mark.from);
            this.model.setSelections([{ anchor: mark.from, head: mark.to }]);
            this.view.revealCaret();
        }
    }

    setWrap(wrap: boolean): void {
        this.settings.wrap = wrap;
        if (wrap) {
            this.view.viewport.scrollLeft = 0;
        }
        this.view.applySettings();
    }

    setChangeMarks(marks: readonly EditorChangeMark[]): void {
        this.view.setChangeMarks(marks);
    }

    setBlocks(blocks: readonly EditorBlock[] | null): void {
        this.view.setBlocks(blocks);
    }

    onScope(listener: (scope: readonly EditorBlock[]) => void): () => void {
        return this.view.onScope(listener);
    }

    setIndentation(indentation: EditorIndentation): void {
        if (indentation.tabSize === this.settings.tabSize && indentation.insertSpaces === this.settings.insertSpaces) {
            return;
        }
        this.settings.tabSize = indentation.tabSize;
        this.settings.insertSpaces = indentation.insertSpaces;
        this.view.applySettings();
    }

    setTheme(theme: EditorTheme): void {
        if (theme !== this.theme) {
            this.theme = theme;
            this.loadTokenizer();
        }
    }

    refreshFont(): void {
        this.view.refreshFont();
    }

    setReadOnly(readOnly: boolean, reason?: string): void {
        this.settings.readOnly = readOnly;
        this.settings.readOnlyReason = reason;
        this.view.applySettings();
    }

    focus(): void {
        this.view.focus();
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        this.changes.clear();
        this.saves.clear();
        this.blurs.clear();
        this.subscription.dispose();
        this.controller.dispose();
        this.view.dispose();
    }

    private clampLine(line: number): number {
        return Math.min(Math.max(1, Math.trunc(line) || 1), this.model.getLineCount()) - 1;
    }
}

class SmartEditorEngine implements EditorEngine {
    private readonly options: SmartEditorEngineOptions;

    constructor(options: SmartEditorEngineOptions) {
        this.options = options;
    }

    mount(element: HTMLElement, options: EditorOptions): Editor {
        return new SmartEditor(this.options, element, options);
    }
}

export function createSmartEditorEngine(options: SmartEditorEngineOptions): EditorEngine {
    return new SmartEditorEngine(options);
}
