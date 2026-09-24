import { useEffect, useMemo, useRef, useState } from 'react';
import type { Editor, EditorFindState } from '@ruimte/editor';
import { compileFind } from '@/find/query';
import type { FindState } from '@/find/use-find';

const NOTHING: EditorFindState = { count: 0, current: null };

export interface EditorFind {
    total: number;
    current: number | null;
    invalid: boolean;
    step(direction: 1 | -1): void;
}

/*
 * The find bar over a file's editor. The editor matches and marks with its own find; the query is only
 * compiled here to say whether a pattern is invalid, in the same words as every other surface. Closing
 * the bar leaves the cursor on the match it was on.
 */
export const useEditorFind = (find: FindState, editor: Editor | null): EditorFind => {
    const [state, setState] = useState<EditorFindState>(NOTHING);
    const compiled = useMemo(() => compileFind(find.query), [find.query]);
    const wasOpen = useRef(false);

    useEffect(() => editor?.onFind(setState), [editor]);

    useEffect(() => {
        if (editor === null) {
            return;
        }
        if (find.open) {
            wasOpen.current = true;
            editor.find(compiled.kind === 'pattern' ? find.query : null);
        } else if (wasOpen.current) {
            wasOpen.current = false;
            editor.endFind();
        }
    }, [editor, find.open, find.query, compiled]);

    return {
        total: find.open ? state.count : 0,
        current: find.open ? state.current : null,
        invalid: find.open && compiled.kind === 'invalid',
        step: (direction) => editor?.findStep(direction)
    };
};
