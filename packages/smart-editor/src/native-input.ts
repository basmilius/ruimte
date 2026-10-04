import type { DocumentModel, Selection, TextEdit } from '@ruimte/smart-editor-core';
import { findChange, modelOffset, textareaOffset, textareaText } from './input.ts';

interface InputContext {
    from: number;
    source: string;
    value: string;
    start: number;
    end: number;
}

export interface NativeInputHost {
    readOnly(): boolean;
    replace(text: string): void;
    /* One typed character, with the pairing and the overtyping a keystroke gets. */
    type(character: string): void;
    apply(edit: TextEdit, selection: Selection): void;
    preview(text: string | undefined): void;
    selectionChanged(selection: Selection): void;
}

/* The most of the document the textarea holds around the caret; a screen reader gets its context, a megabyte file does not get copied on every keystroke. */
const CONTEXT = 8192;

/* A dead key and the key after it commit as one composition of at most two characters, which is typing and not an input method's text. */
const DEAD_KEY_RESULT = /^[\x20-\x7e]{1,2}$/;

/*
 * The hidden textarea. It is the sink for what the platform types, composes and pastes, and carries
 * the text around the caret for assistive technology. It never draws and never decides: the model
 * owns the text and the selection, and the textarea is written from it.
 */
export class NativeInput {
    composing = false;
    private context: InputContext = { from: 0, source: '', value: '', start: 0, end: 0 };
    private compositionContext: InputContext | undefined;
    private writing = false;
    private readonly element: HTMLTextAreaElement;
    private readonly model: DocumentModel;
    private readonly host: NativeInputHost;

    constructor(element: HTMLTextAreaElement, model: DocumentModel, host: NativeInputHost) {
        this.element = element;
        this.model = model;
        this.host = host;
    }

    sync(): void {
        if (this.composing) {
            return;
        }
        const selections = this.model.getSelections();
        const selection = selections[0]!;
        const length = this.model.getLength();
        const start = Math.min(selection.anchor, selection.head);
        const end = Math.max(selection.anchor, selection.head);
        let from = 0;
        let to = length;
        if (length > CONTEXT) {
            from = Math.max(0, Math.min(start, selection.head - 2048));
            to = Math.min(length, end + 2048);
            if (to - from > CONTEXT) {
                from = Math.max(0, selection.head - CONTEXT / 2);
                to = Math.min(length, from + CONTEXT);
            }
            // A boundary must not split a surrogate pair or a CRLF.
            if (from > 0 && /[\uDC00-\uDFFF\n]/.test(this.model.slice(from, from + 1))) {
                from--;
            }
            if (to < length && /[\uDC00-\uDFFF\n]/.test(this.model.slice(to, to + 1))) {
                to++;
            }
        }
        const source = this.model.slice(from, to);
        const value = textareaText(source);
        const nativeStart = textareaOffset(source, Math.max(0, start - from));
        const nativeEnd = textareaOffset(source, Math.max(0, end - from));
        this.context = { from, source, value, start: nativeStart, end: nativeEnd };
        this.writing = true;
        if (this.element.value !== value) {
            this.element.value = value;
        }
        this.element.setSelectionRange(nativeStart, nativeEnd, selection.head < selection.anchor ? 'backward' : 'forward');
        this.writing = false;
        const position = this.model.positionAt(selection.head);
        this.element.setAttribute(
            'aria-description',
            `Line ${position.line + 1}, column ${position.column + 1}. ${selections.length} caret${selections.length === 1 ? '' : 's'}.`
        );
    }

    /* A selection the platform made inside the textarea, such as a long press or an accessibility action. */
    readSelection(): void {
        if (this.writing || this.composing || this.element.value !== this.context.value) {
            return;
        }
        const start = this.element.selectionStart;
        const end = this.element.selectionEnd;
        if (start === this.context.start && end === this.context.end) {
            return;
        }
        const from = this.context.from + modelOffset(this.context.source, start);
        const to = this.context.from + modelOffset(this.context.source, end);
        this.host.selectionChanged(this.element.selectionDirection === 'backward' ? { anchor: to, head: from } : { anchor: from, head: to });
    }

    onInput(): void {
        if (this.composing) {
            this.host.preview(this.composedText());
            return;
        }
        if (this.host.readOnly()) {
            this.sync();
            return;
        }
        const context = this.context;
        const change = findChange(context.value, this.element.value);
        if (change.from === change.to && !change.text) {
            return;
        }
        if (this.model.getSelections().length > 1) {
            const suffix = context.value.length - context.end;
            this.host.replace(this.element.value.slice(context.start, Math.max(context.start, this.element.value.length - suffix)));
            return;
        }
        const edit = {
            from: context.from + modelOffset(context.source, change.from),
            to: context.from + modelOffset(context.source, change.to),
            text: this.normalizeNewlines(change.text)
        };
        const next = context.source.slice(0, edit.from - context.from) + edit.text + context.source.slice(edit.to - context.from);
        const start = context.from + modelOffset(next, this.element.selectionStart);
        const end = context.from + modelOffset(next, this.element.selectionEnd);
        this.host.apply(edit, this.element.selectionDirection === 'backward' ? { anchor: end, head: start } : { anchor: start, head: end });
    }

    startComposition(): void {
        if (this.host.readOnly()) {
            return;
        }
        this.compositionContext = { ...this.context };
        this.composing = true;
    }

    endComposition(data: string): void {
        if (!this.composing) {
            return;
        }
        const text = this.composedText();
        const context = this.compositionContext!;
        const unchanged = this.element.value === context.value;
        this.composing = false;
        this.compositionContext = undefined;
        this.host.preview(undefined);
        if (data && !unchanged && !this.host.readOnly()) {
            if (DEAD_KEY_RESULT.test(text)) {
                for (const character of text) {
                    this.host.type(character);
                }
            } else {
                this.host.replace(text);
            }
        }
        this.sync();
    }

    /* The document's own line break, not the textarea's. */
    normalizeNewlines(text: string): string {
        const first = this.model.getLine(0);
        const newline = this.model.slice(first.end, first.next) === '\r\n' ? '\r\n' : '\n';
        return textareaText(text).replace(/\n/g, newline);
    }

    private composedText(): string {
        const context = this.compositionContext!;
        const suffix = context.value.length - context.end;
        return this.element.value.slice(context.start, Math.max(context.start, this.element.value.length - suffix));
    }
}
