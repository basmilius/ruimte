import { useEffect } from 'react';
import type { Editor } from '@ruimte/smart-editor';
import { changeMarksOf } from '@/shell/panels/change-marks';

/* A pause in typing this long before the margin is worked out again, since a diff reads both texts. */
const MARK_DELAY_MS = 200;

/* Marks the lines of the editor that differ from `base` in its margin and scroll track, and keeps them up with what is typed. */
export function useChangeMarks(editor: Editor | null, base: string | null): void {
    useEffect(() => {
        if (editor === null || base === null) {
            return;
        }
        const mark = (): void => editor.setChangeMarks(changeMarksOf(base, editor.getText()));
        mark();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const off = editor.onChange(() => {
            clearTimeout(timer);
            timer = setTimeout(mark, MARK_DELAY_MS);
        });
        return () => {
            clearTimeout(timer);
            off();
            editor.setChangeMarks([]);
        };
    }, [editor, base]);
}
