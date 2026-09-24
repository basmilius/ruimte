import { useEffect, useLayoutEffect, useRef } from 'react';
import { defaultKeymap, history, historyKeymap } from '@codemirror/commands';
import { indentUnit } from '@codemirror/language';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers } from '@codemirror/view';
import type { ConflictFile } from '@/conflicts/conflict-model';
import { applyBlock, blockAt, mergeDecorations, revealBlock, setSpans, spansField, spansOf, type ConflictDraft } from '@/conflicts/editor';

export interface EditorHandle {
    /* The file this editor holds, which is what an answer that arrives later is checked against. */
    readonly path: string;
    apply(block: number, lines: readonly string[]): void;
    reveal(block: number): void;
}

interface Props {
    readonly file: ConflictFile;
    /* What was typed the last time this file was open, or null to start from the merged draft. Read
       when the file opens rather than passed in, since it is held outside React between openings. */
    held(): ConflictDraft | null;
    onChange(draft: ConflictDraft, current: number | null): void;
    onReady(handle: EditorHandle | null): void;
}

/*
 * The merged file, and the only editable side of the three. It opens on what merges by itself, with
 * every conflict marked where it sits; taking a side replaces that stretch, and typing in one is
 * answering it just the same. What comes out is the file as it will be written, never a marker.
 */
export function ConflictEditor({ file, held, onChange, onReady }: Props) {
    const host = useRef<HTMLDivElement>(null);
    const latest = useRef({ onChange, onReady, held });

    useLayoutEffect(() => {
        latest.current = { onChange, onReady, held };
    });

    useEffect(() => {
        const element = host.current;
        if (element === null) {
            return;
        }
        const draft = latest.current.held();
        const view = new EditorView({
            state: EditorState.create({
                doc: draft?.text ?? file.text,
                extensions: [
                    lineNumbers(),
                    history(),
                    keymap.of([...defaultKeymap, ...historyKeymap]),
                    indentUnit.of('    '),
                    spansField,
                    mergeDecorations,
                    EditorView.updateListener.of((update) => {
                        if (update.docChanged || update.selectionSet) {
                            const spans = update.state.field(spansField);
                            latest.current.onChange({ text: update.state.doc.toString(), spans }, blockAt(update.state, update.state.selection.main.head));
                        }
                    })
                ]
            }),
            parent: element
        });
        // The spans carry positions, so they go in once the document they point into is there.
        view.dispatch({ effects: setSpans.of(draft?.spans ?? spansOf(view.state.doc, file.spans)) });
        latest.current.onChange({ text: view.state.doc.toString(), spans: view.state.field(spansField) }, null);
        latest.current.onReady({
            path: file.path,
            apply: (block, lines) => applyBlock(view, block, lines),
            reveal: (block) => revealBlock(view, block)
        });
        return () => {
            latest.current.onReady(null);
            view.destroy();
        };
    }, [file]);

    return <div ref={host} className="conflict-editor min-h-0 grow overflow-hidden" />;
}
