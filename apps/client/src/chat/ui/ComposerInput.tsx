import { DictationControl } from '@/dictation/DictationControl';
import { captureEditor, dictationPreview, dictationRange } from '@/dictation/editor';
import { useImperativeHandle, useLayoutEffect, useRef, useState, type Ref } from 'react';
import { Compartment, EditorState, Prec, Transaction, type Extension } from '@codemirror/state';
import { EditorView, placeholder as placeholderText } from '@codemirror/view';
import { composerEditorExtensions, externalChange } from '@/chat/ui/composer/editor';

export interface ComposerInputHandle {
    focus(): void;
    /* Puts the caret at `pos`, clamped to the text, and gives the editor the focus. */
    setCaret(pos: number): void;
}

export interface InputSelection {
    from: number;
    to: number;
}

interface ComposerInputProps {
    ref?: Ref<ComposerInputHandle>;
    dictationToolbar?: HTMLElement | null;
    value: string;
    /* An element for a placeholder with markup of its own; keep its reference stable, as with `extensions`. */
    placeholder: string | HTMLElement;
    disabled: boolean;
    tabbable: boolean;
    className?: string;
    /* Keep the reference stable. A new one reconfigures the editor. */
    extensions?: Extension;
    onChange(text: string, selection: InputSelection, state: EditorState): void;
    onSelectionChange?(text: string, selection: InputSelection, state: EditorState): void;
    onBlur?(): void;
    /* Runs before the editor's own keymap; true means the key is handled and its default prevented. */
    onKeyDown?(event: KeyboardEvent, view: EditorView): boolean;
    /* Runs before the editor pastes the plain text itself; true means the paste is handled. */
    onPaste?(event: ClipboardEvent, view: EditorView): boolean;
}

const NO_EXTENSIONS: Extension = [];

/*
 * A multi-line text field on CodeMirror, controlled by a plain string. The editor draws the text
 * itself, so a decoration may change a font or add padding without walking the caret off its
 * character, which a textarea with a painted layer behind it could not.
 */
export function ComposerInput({
    ref,
    value,
    placeholder,
    disabled,
    tabbable,
    className,
    dictationToolbar,
    extensions = NO_EXTENSIONS,
    ...handlers
}: ComposerInputProps) {
    const hostRef = useRef<HTMLDivElement>(null);
    const targetRef = useRef<HTMLDivElement>(null);
    const viewRef = useRef<EditorView | null>(null);
    const [compartments] = useState(() => ({
        attributes: new Compartment(),
        editable: new Compartment(),
        placeholder: new Compartment(),
        extensions: new Compartment()
    }));
    const latest = useRef({ value, handlers });
    // What the editor last reported. The parent handing that back is catching up, not setting a value of its own.
    const reported = useRef(value);

    useLayoutEffect(() => {
        latest.current = { value, handlers };
    });

    useLayoutEffect(() => {
        const host = hostRef.current;
        if (!host) {
            return;
        }
        const initial = latest.current.value;
        const view = new EditorView({
            parent: host,
            state: EditorState.create({
                doc: initial,
                selection: { anchor: initial.length },
                extensions: [
                    composerEditorExtensions(),
                    dictationRange,
                    dictationPreview,
                    compartments.attributes.of([]),
                    compartments.editable.of([]),
                    compartments.placeholder.of([]),
                    compartments.extensions.of([]),
                    Prec.highest(
                        EditorView.domEventHandlers({
                            keydown: (event, target) => latest.current.handlers.onKeyDown?.(event, target) ?? false,
                            paste: (event, target) => latest.current.handlers.onPaste?.(event, target) ?? false
                        })
                    ),
                    EditorView.updateListener.of((update) => {
                        const current = latest.current.handlers;
                        if (update.focusChanged && !update.view.hasFocus) {
                            current.onBlur?.();
                        }
                        if ((!update.docChanged && !update.selectionSet) || update.transactions.some((tr) => tr.annotation(externalChange))) {
                            return;
                        }
                        const text = update.state.doc.toString();
                        const { from, to } = update.state.selection.main;
                        if (update.docChanged) {
                            reported.current = text;
                            current.onChange(text, { from, to }, update.state);
                        } else {
                            current.onSelectionChange?.(text, { from, to }, update.state);
                        }
                    })
                ]
            })
        });
        viewRef.current = view;
        return () => {
            view.destroy();
            viewRef.current = null;
        };
    }, [compartments]);

    useLayoutEffect(() => {
        viewRef.current?.dispatch({
            effects: [
                // Spellcheck stays on, as it was on the textarea this editor replaced.
                compartments.attributes.reconfigure(EditorView.contentAttributes.of({ spellcheck: 'true', tabindex: tabbable ? '0' : '-1' })),
                compartments.editable.reconfigure([EditorView.editable.of(!disabled), EditorState.readOnly.of(disabled)]),
                compartments.placeholder.reconfigure(placeholderText(placeholder)),
                compartments.extensions.reconfigure(extensions)
            ]
        });
    }, [compartments, tabbable, disabled, placeholder, extensions]);

    useLayoutEffect(() => {
        const view = viewRef.current;
        if (!view || value === reported.current) {
            return;
        }
        reported.current = value;
        const doc = view.state.doc.toString();
        if (value === doc) {
            return;
        }
        view.dispatch({
            changes: { from: 0, to: doc.length, insert: value },
            selection: { anchor: value.length },
            annotations: [externalChange.of(true), Transaction.addToHistory.of(false)]
        });
    }, [value]);

    useImperativeHandle(
        ref,
        () => ({
            focus: () => viewRef.current?.focus(),
            setCaret: (pos: number) => {
                const view = viewRef.current;
                if (!view) {
                    return;
                }
                view.dispatch({ selection: { anchor: Math.min(pos, view.state.doc.length) }, scrollIntoView: true });
                view.focus();
            }
        }),
        []
    );

    return (
        <div ref={targetRef} className="min-w-0">
            <div ref={hostRef} className={className} />
            <DictationControl
                inlinePreview
                buttonContainer={dictationToolbar}
                targetRef={targetRef}
                disabled={disabled}
                capture={() => (viewRef.current ? captureEditor(viewRef.current) : null)}
            />
        </div>
    );
}
