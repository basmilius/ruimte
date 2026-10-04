import type { CommandOptions, EditorCommand, Selection, TextEdit } from '@ruimte/smart-editor-core';
import { replacementEdits } from './input.ts';
import { chordMatches, type KeyAction, keyAction, type MoveKey } from './keymap.ts';
import { NativeInput } from './native-input.ts';
import { columnSelections, sameCell } from './column-selection.ts';
import { PointerSelection } from './pointer.ts';
import type { EditorClick, EditorClickHandler, EditorContextMenu, EditorKeyHandler, EditorPosition, KeyChord } from './types.ts';
import type { EditorView } from './view.ts';

export interface ControllerOptions {
    handBack: readonly KeyChord[];
    apple: boolean;
    save(): void;
    blur(): void;
}

const MODIFYING = new Set<EditorCommand>([
    'undo',
    'redo',
    'deleteWordLeft',
    'deleteWordRight',
    'deleteCamelLeft',
    'deleteCamelRight',
    'duplicateLine',
    'deleteLine',
    'moveLineUp',
    'moveLineDown',
    'toggleLineComment',
    'toggleBlockComment',
    'startNewLine',
    'startNewLineBefore',
    'splitLine',
    'joinLines',
    'toggleCase',
    'autoIndentLines',
    'insertTab',
    'indent',
    'outdent',
    'insertNewline',
    'smartBackspace',
    'deleteForward'
]);

/* Typing in the same stretch is one undo step until a pause this long. */
const TYPING_PAUSE_MS = 750;
const PAIR_CHARACTER = /^[()[\]{}'"`;<]$/;

/*
 * What a person does to the editor: keys, typing, the clipboard, an input method, the mouse. It turns
 * each into a command on the model and leaves the drawing to the view.
 */
export class InputController {
    private readonly native: NativeInput;
    private readonly pointer: PointerSelection;
    private readonly cleanup: (() => void)[] = [];
    private readonly keyHandlers = new Set<EditorKeyHandler>();
    private readonly clickHandlers = new Set<EditorClickHandler>();
    private readonly contextListeners = new Set<(menu: EditorContextMenu) => void>();
    private readonly subscription: { dispose(): void };
    private historyGroup = 0;
    /* The clipboard text of the last copy or cut of a bare caret, which pastes back as whole lines. */
    private lineClip: string | null = null;
    private lastInputAt = 0;
    private desiredXs: number[] = [];
    private keepDesiredXs = false;
    private readonly view: EditorView;
    private readonly options: ControllerOptions;

    constructor(view: EditorView, options: ControllerOptions) {
        this.view = view;
        this.options = options;
        const { model, input, viewport } = view;
        this.native = new NativeInput(input, model, {
            readOnly: () => view.settings.readOnly,
            replace: (text) => this.replaceSelections(text),
            type: (character) => this.typeText(character),
            apply: (edit, selection) => {
                this.applyEdits([edit], [selection]);
                view.revealCaret();
            },
            preview: (text) => view.setComposition(text),
            selectionChanged: (selection) => {
                this.historyGroup++;
                model.setSelections([selection]);
                view.revealCaret();
            }
        });
        this.pointer = new PointerSelection({
            model,
            viewport,
            offsetAt: (x, y) => view.offsetAtPoint(x, y),
            contentPoint: (x, y) => view.contentPoint(x, y),
            columnSelections: (from, to) => (sameCell(view.layout, from, to) ? null : columnSelections(view.layout, from, to)),
            focus: () => view.focus(),
            scrolled: () => view.requestRender()
        });
        this.subscription = model.subscribe(() => {
            if (!this.keepDesiredXs) {
                this.desiredXs = [];
            }
            this.native.sync();
        });
        this.native.sync();
        this.attach();
    }

    private listen<Event extends keyof HTMLElementEventMap>(target: HTMLElement, name: Event, callback: (event: HTMLElementEventMap[Event]) => void): void {
        target.addEventListener(name, callback);
        this.cleanup.push(() => target.removeEventListener(name, callback));
    }

    private attach(): void {
        const { input, viewport, root } = this.view;
        const document = root.ownerDocument;
        this.listen(input, 'keydown', (event) => this.keydown(event));
        this.listen(input, 'beforeinput', (event) => this.beforeInput(event));
        this.listen(input, 'input', () => this.native.onInput());
        this.listen(input, 'compositionstart', () => {
            this.historyGroup++;
            this.native.startComposition();
        });
        this.listen(input, 'compositionend', (event) => {
            this.native.endComposition(event.data);
            this.historyGroup++;
            this.view.render();
        });
        this.listen(input, 'select', () => this.native.readSelection());
        this.listen(input, 'focus', () => this.view.requestRender());
        this.listen(input, 'blur', () => this.view.requestRender());
        this.listen(root, 'focusout', (event) => {
            if (!(event.relatedTarget instanceof Node) || !root.contains(event.relatedTarget)) {
                this.options.blur();
            }
        });
        this.listen(input, 'paste', (event) => {
            event.preventDefault();
            this.paste(event.clipboardData?.getData('text/plain') ?? '');
        });
        this.listen(input, 'copy', (event) => this.copy(event, false));
        this.listen(input, 'cut', (event) => this.copy(event, true));
        this.listen(viewport, 'scroll', () => this.view.scrolled());
        this.listen(viewport, 'pointermove', (event) => this.view.hoverMoved(event));
        this.listen(viewport, 'pointerleave', () => this.view.setHover(null));
        this.listen(viewport, 'pointerdown', (event) => this.pointerDown(event));
        this.listen(viewport, 'contextmenu', (event) => this.contextMenu(event));
        this.listen(this.view.gutterElement, 'pointerdown', (event) => this.gutterDown(event));
        this.listen(this.view.stickyElement, 'pointerdown', (event) => this.stickyDown(event));
        const move = (event: Event): void => this.pointer.move(event as PointerEvent);
        const end = (): void => {
            this.pointer.end();
            this.historyGroup++;
        };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', end);
        document.addEventListener('pointercancel', end);
        this.cleanup.push(() => {
            document.removeEventListener('pointermove', move);
            document.removeEventListener('pointerup', end);
            document.removeEventListener('pointercancel', end);
        });
    }

    dispose(): void {
        this.subscription.dispose();
        this.pointer.dispose();
        for (const remove of this.cleanup) {
            remove();
        }
        this.cleanup.length = 0;
        this.keyHandlers.clear();
    }

    /* Tells a person why nothing happened, when the editor is read only and has said why. */
    private blockedByReadOnly(): boolean {
        if (!this.view.settings.readOnly) {
            return false;
        }
        if (this.view.settings.readOnlyReason) {
            this.view.notify(this.view.settings.readOnlyReason);
        }
        return true;
    }

    private inputGroup(): string {
        const now = Date.now();
        if (now - this.lastInputAt > TYPING_PAUSE_MS) {
            this.historyGroup++;
        }
        this.lastInputAt = now;
        return `view-input-${this.historyGroup}`;
    }

    private applyEdits(edits: readonly TextEdit[], selections?: readonly Selection[]): boolean {
        if (this.view.settings.readOnly) {
            return false;
        }
        return this.view.model.applyEdits(edits, { selections, source: 'input', historyGroup: this.inputGroup() });
    }

    private replaceSelections(text: string): void {
        if (this.blockedByReadOnly()) {
            return;
        }
        const { model } = this.view;
        for (const selection of model.getSelections()) {
            this.view.ensureVisible(selection.head);
        }
        const replacement = replacementEdits(model.getSelections(), this.native.normalizeNewlines(text));
        this.applyEdits(replacement.edits, replacement.selections);
        this.view.revealCaret();
    }

    private paste(text: string): void {
        if (this.blockedByReadOnly()) {
            return;
        }
        const { model } = this.view;
        for (const selection of model.getSelections()) {
            this.view.ensureVisible(selection.head);
        }
        this.historyGroup++;
        model.paste(this.native.normalizeNewlines(text), { ...this.commandOptions(), wholeLines: text !== '' && text === this.lineClip });
        this.historyGroup++;
        this.view.revealCaret();
    }

    private commandOptions(): CommandOptions {
        const { settings } = this.view;
        const keys = settings.smartKeys;
        return {
            tabSize: settings.tabSize,
            insertSpaces: settings.insertSpaces,
            autoClosingBrackets: keys.autoPairBrackets,
            autoClosingQuotes: keys.autoPairQuotes,
            surroundSelection: keys.surroundSelection,
            tabOutOfClosers: keys.tabOutOfClosers,
            smartEnter: keys.smartIndentOnEnter,
            indentOnPaste: keys.indentOnPaste,
            smartSemicolon: keys.smartSemicolon,
            language: settings.language ?? 'plaintext',
            camelCase: keys.camelHumps
        };
    }

    /* Runs a model command on every caret, with the folds that would hide its result opened first. */
    command(name: EditorCommand): boolean {
        const { model, layout } = this.view;
        const modifies = MODIFYING.has(name) && name !== 'undo' && name !== 'redo';
        if ((modifies || name === 'undo' || name === 'redo') && this.blockedByReadOnly()) {
            return false;
        }
        this.historyGroup++;
        if (name === 'addCaretAbove' || name === 'addCaretBelow') {
            const selections = model.getSelections();
            model.setSelections([
                ...selections,
                ...selections.map((selection) => {
                    const head = layout.verticalOffset(selection.head, name === 'addCaretAbove' ? -1 : 1, layout.caret(selection.head).x);
                    return { anchor: head, head };
                })
            ]);
            this.view.revealCaret();
            return true;
        }
        if (modifies) {
            for (const selection of model.getSelections()) {
                this.view.ensureVisible(selection.head);
                const position = model.positionAt(selection.head);
                const line = model.getLine(position.line);
                if ((name === 'smartBackspace' || name === 'deleteWordLeft') && selection.head === line.start && position.line > 0) {
                    this.view.ensureVisible(model.getLine(position.line - 1).start);
                }
                if ((name === 'deleteForward' || name === 'deleteWordRight') && selection.head === line.end && position.line + 1 < model.getLineCount()) {
                    this.view.ensureVisible(model.getLine(position.line + 1).start);
                }
            }
        }
        const result = model.execute(name, this.commandOptions());
        this.view.revealCaret();
        return result;
    }

    private typeText(text: string): void {
        if (this.blockedByReadOnly()) {
            return;
        }
        for (const selection of this.view.model.getSelections()) {
            this.view.ensureVisible(selection.head);
        }
        if (PAIR_CHARACTER.test(text)) {
            this.view.model.typeText(text, { ...this.commandOptions(), historyGroup: this.inputGroup() });
            this.view.revealCaret();
        } else {
            this.replaceSelections(text);
        }
    }

    private moveCarets(key: MoveKey, extend: boolean): void {
        const { model, layout, viewport } = this.view;
        const vertical = key === 'ArrowUp' || key === 'ArrowDown' || key === 'PageUp' || key === 'PageDown';
        const direction = key === 'ArrowLeft' || key === 'ArrowUp' || key === 'PageUp' ? -1 : 1;
        const selections = model.getSelections().map((selection, index) => {
            let head: number;
            if (!vertical && !extend && selection.anchor !== selection.head) {
                head = direction < 0 ? Math.min(selection.anchor, selection.head) : Math.max(selection.anchor, selection.head);
            } else if (vertical) {
                this.desiredXs[index] ??= layout.caret(selection.head).x;
                const distance = key.startsWith('Page')
                    ? Math.max(layout.metrics.lineHeight, (viewport.clientHeight || 400) - layout.metrics.lineHeight)
                    : layout.metrics.lineHeight;
                head = layout.verticalOffset(selection.head, direction, this.desiredXs[index]!, distance);
            } else {
                head = layout.horizontalOffset(selection.head, direction);
            }
            return { anchor: extend ? selection.anchor : head, head };
        });
        this.keepDesiredXs = vertical;
        model.setSelections(selections);
        this.keepDesiredXs = false;
        if (!vertical) {
            this.desiredXs = [];
        }
        this.historyGroup++;
        this.view.revealCaret();
    }

    private goToMatchingBracket(): void {
        const { model } = this.view;
        let changed = false;
        model.setSelections(
            model.getSelections().map((selection) => {
                const bracket = this.view.matchingBracket(selection);
                if (!bracket || bracket.mate === undefined) {
                    return selection;
                }
                const head = bracket.mate > bracket.at ? bracket.mate + 1 : bracket.mate;
                changed = true;
                return { anchor: head, head };
            })
        );
        if (changed) {
            this.view.revealCaret();
        }
    }

    private run(action: KeyAction, event: KeyboardEvent): void {
        const { model } = this.view;
        switch (action.type) {
            case 'save':
                event.preventDefault();
                this.options.save();
                return;
            case 'command':
                event.preventDefault();
                this.command(action.command);
                return;
            case 'move':
                event.preventDefault();
                this.moveCarets(action.key, action.extend);
                return;
            case 'edge': {
                event.preventDefault();
                const head = action.end ? model.getLength() : 0;
                model.setSelections([{ anchor: action.extend ? model.getPrimary().anchor : head, head }]);
                this.view.revealCaret();
                return;
            }
            case 'bracket':
                event.preventDefault();
                this.goToMatchingBracket();
                return;
            case 'fold':
                event.preventDefault();
                this.view.foldAround(action.collapse, action.all);
                return;
            case 'escape': {
                const selections = model.getSelections();
                if (selections.length > 1 || selections[0]!.anchor !== selections[0]!.head) {
                    event.preventDefault();
                    // The oldest caret stays; the newest ones go.
                    const head = selections[0]!.head;
                    model.setSelections([{ anchor: head, head }]);
                    if (selections.length > 1) {
                        this.view.revealCaret();
                    }
                }
                return;
            }
        }
    }

    /* A handler sees the key before the editor does, the page's own shortcuts included, since a list of suggestions owns the arrows while it is open. */
    onKeyDown(handler: EditorKeyHandler): () => void {
        this.keyHandlers.add(handler);
        return () => {
            this.keyHandlers.delete(handler);
        };
    }

    onClick(handler: EditorClickHandler): () => void {
        this.clickHandlers.add(handler);
        return () => {
            this.clickHandlers.delete(handler);
        };
    }

    onContextMenu(listener: (menu: EditorContextMenu) => void): () => void {
        this.contextListeners.add(listener);
        return () => {
            this.contextListeners.delete(listener);
        };
    }

    private keydown(event: KeyboardEvent): void {
        if (event.isComposing || this.native.composing) {
            return;
        }
        for (const handler of [...this.keyHandlers]) {
            if (handler(event)) {
                event.preventDefault();
                return;
            }
        }
        // The app's own shortcuts stay the app's, also where the editor has a binding for the same key.
        if (this.options.handBack.some((chord) => chordMatches(chord, event, this.options.apple))) {
            return;
        }
        const action = keyAction(event, this.options.apple);
        if (action) {
            this.run(action, event);
        }
    }

    private beforeInput(event: InputEvent): void {
        if (this.view.settings.readOnly) {
            event.preventDefault();
            this.blockedByReadOnly();
            return;
        }
        if (this.native.composing || event.isComposing) {
            return;
        }
        switch (event.inputType) {
            case 'insertText':
            case 'insertReplacementText':
                event.preventDefault();
                if (event.data !== null) {
                    this.typeText(event.data);
                }
                return;
            case 'insertLineBreak':
            case 'insertParagraph':
                event.preventDefault();
                this.command('insertNewline');
                return;
            case 'deleteContentBackward':
                event.preventDefault();
                this.command('smartBackspace');
                return;
            case 'deleteContentForward':
                event.preventDefault();
                this.command('deleteForward');
                return;
            case 'historyUndo':
            case 'historyRedo':
                event.preventDefault();
                this.command(event.inputType === 'historyUndo' ? 'undo' : 'redo');
                return;
        }
    }

    /* A cut or copy of nothing selected takes the lines the carets are on. */
    private copy(event: ClipboardEvent, cut: boolean): void {
        event.preventDefault();
        const { model } = this.view;
        const selections = model.getSelections();
        const empty = selections.every((selection) => selection.anchor === selection.head);
        const text = empty
            ? selections
                  .map((selection) => model.getLine(model.positionAt(selection.head).line))
                  .map((line) => model.slice(line.start, line.next) + (line.next === line.end ? '\n' : ''))
                  .join('')
            : selections.map((selection) => model.slice(Math.min(selection.anchor, selection.head), Math.max(selection.anchor, selection.head))).join('\n');
        event.clipboardData?.setData('text/plain', text);
        this.lineClip = empty ? text : null;
        if (!cut || this.blockedByReadOnly()) {
            return;
        }
        this.historyGroup++;
        if (empty) {
            this.command('deleteLine');
        } else {
            this.replaceSelections('');
        }
        this.historyGroup++;
    }

    private pointerDown(event: PointerEvent): void {
        const target = event.target as HTMLElement;
        if (event.button !== 0 || target.closest('button, a, input, textarea, [contenteditable], .se-block, .se-gutter, .se-sticky')) {
            return;
        }
        event.preventDefault();
        if (this.takenByHost(event)) {
            this.view.focus();
            return;
        }
        this.pointer.start(event);
    }

    /* Whether a handler of the host took a press on a character, such as a Mod+click that follows a name. */
    private takenByHost(event: PointerEvent): boolean {
        if (this.clickHandlers.size === 0) {
            return false;
        }
        const offset = this.view.characterAtPoint(event.clientX, event.clientY, event.target);
        if (offset === null) {
            return false;
        }
        const click: EditorClick = {
            position: this.positionOf(offset),
            mod: this.options.apple ? event.metaKey : event.ctrlKey,
            alt: event.altKey,
            shift: event.shiftKey
        };
        return [...this.clickHandlers].some((handler) => handler(click));
    }

    private positionOf(offset: number): EditorPosition {
        const { line, column } = this.view.model.positionAt(offset);
        return { line, character: column };
    }

    private contextMenu(event: MouseEvent): void {
        if (this.contextListeners.size === 0 || (event.target as HTMLElement | null)?.closest?.('.se-sticky')) {
            return;
        }
        event.preventDefault();
        const offset = this.view.offsetAtPoint(event.clientX, event.clientY);
        const selection = this.view.model
            .getSelections()
            .some((candidate) => Math.min(candidate.anchor, candidate.head) <= offset && offset <= Math.max(candidate.anchor, candidate.head));
        const menu: EditorContextMenu = { position: this.positionOf(offset), inSelection: selection, x: event.clientX, y: event.clientY };
        for (const listener of [...this.contextListeners]) {
            listener(menu);
        }
    }

    /* A press on a pinned header goes to that header. */
    private stickyDown(event: PointerEvent): void {
        const row = (event.target as HTMLElement | null)?.closest?.<HTMLElement>('.se-sticky-row');
        if (event.button !== 0 || !row) {
            return;
        }
        event.preventDefault();
        this.view.jumpToHeader(Number(row.dataset.line), Number(row.dataset.depth));
        this.view.focus();
    }

    /* A press on a line number selects the line. */
    private gutterDown(event: PointerEvent): void {
        if (event.button !== 0) {
            return;
        }
        event.preventDefault();
        /* On the press and not on click: a repaint in between replaces the gutter's buttons, and a click whose button left the DOM never arrives. */
        const actionLine = this.view.gutterActionLineOf(event.target);
        if (actionLine !== null) {
            this.view.pressGutterAction(actionLine);
            return;
        }
        const foldLine = this.view.foldLineOf(event.target);
        if (foldLine !== null) {
            this.view.toggleFold(foldLine);
            this.view.focus();
            return;
        }
        const { model, layout } = this.view;
        const row = layout.rowAt(this.view.contentPoint(event.clientX, event.clientY).y);
        if (row.kind === 'text') {
            const line = model.getLine(row.line);
            model.setSelections([{ anchor: line.start, head: line.next }]);
        }
        this.view.focus();
    }
}
