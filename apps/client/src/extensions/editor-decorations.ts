import type { Editor, EditorLineHighlight } from '@adecore/editor';
import { highlightLayers } from '@adecore/editor-react';
import { messageOf } from '@adecore/ui';
import type { EditorDecorationKind, EditorDecorationMark } from '@ruimte/contracts';
import { useEffect } from 'react';
import { fileInfoOf } from '@/extensions/file-info';
import { useContributions, type EditorDecorationContribution } from '@/state/extension-registry';

/* The color each kind of mark is drawn in, as a token of the theme, so a mark follows light and dark. */
export const DECORATION_COLORS: Readonly<Record<EditorDecorationKind, string>> = {
    info: '--status-running',
    success: '--status-idle',
    warning: '--status-needs-you',
    error: '--status-error',
    muted: '--text-muted'
};

const SIGN = '●';

/*
 * A mark as the editor's line highlight: a sign beside the line number and nothing over the text, so the change mark
 * of git stays beside it and a line reads as it did.
 */
function highlightOf(mark: EditorDecorationMark): EditorLineHighlight {
    return { startLine: mark.line, endLine: mark.endLine, color: DECORATION_COLORS[mark.kind], fill: 'transparent', sign: SIGN };
}

/* One source's marks in one editor: asked now and after each refresh, and taken out when the editor goes. */
function follow(editor: Editor, path: string, source: EditorDecorationContribution): () => void {
    const layers = highlightLayers(editor);
    const owner = `extension:${source.id}`;
    let highlights: readonly EditorLineHighlight[] = [];
    let asked = 0;
    let live = true;
    const ask = (): void => {
        const turn = ++asked;

        source.provide(fileInfoOf(path)).then(
            (marks) => {
                // An answer to an earlier ask, or for an editor that closed, draws nothing.
                if (live && turn === asked) {
                    highlights = marks.map(highlightOf);
                    // Set again under the same owner, which keeps its place below what Ruimte tints later, such as a review.
                    layers.set(owner, () => highlights);
                }
            },
            (e: unknown) => source.onFailure(messageOf(e))
        );
    };
    const stop = source.onRefresh(ask);

    ask();

    return () => {
        live = false;
        stop();
        layers.set(owner, null);
    };
}

/*
 * What extensions mark in the margin of an editor. Each is told the file and asked for its marks, which go into the
 * editor's shared line highlights under an owner of their own. Nothing here hands an extension the editor.
 */
export function useEditorDecorations(editor: Editor | null, path: string): void {
    const sources = useContributions((state) => state.editorDecorations);

    useEffect(() => {
        if (editor === null || sources.length === 0) {
            return;
        }

        const stops = sources.map((source) => follow(editor, path, source));

        return () => {
            for (const stop of stops) {
                stop();
            }
        };
    }, [editor, path, sources]);
}
