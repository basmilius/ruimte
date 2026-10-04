import { useEffect, useState } from 'react';
import type { Editor, EditorBlock } from '@ruimte/smart-editor';

const NOTHING: readonly EditorBlock[] = [];

/* The named blocks around the editor's caret, outermost first, which a breadcrumb draws. */
export function useEditorScope(editor: Editor | null): readonly EditorBlock[] {
    const [state, setState] = useState<{ editor: Editor | null; scope: readonly EditorBlock[] }>({ editor: null, scope: NOTHING });

    useEffect(() => editor?.onScope((scope) => setState({ editor, scope })), [editor]);

    // What an editor said stays with it, so the next editor starts from nothing and not from where the last one was.
    return state.editor === editor ? state.scope : NOTHING;
}
