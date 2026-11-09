import type { Editor } from '@adecore/editor';
import { useEffect } from 'react';
import { changeMarksOf } from '@/files/change-marks';

/* A pause in typing this long before the margin is worked out again, since a diff reads both texts. */
const MARK_DELAY_MS = 200;

export function useChangeMarks(editor: Editor | null, base: string | null): void {
    useEffect(() => {
        if (editor === null || base === null) {
            return;
        }
        const mark = (): void => editor.setChangeMarks(changeMarksOf(base, editor.getText()), 'git');
        mark();
        let timer: ReturnType<typeof setTimeout> | undefined;
        const off = editor.onChange(() => {
            clearTimeout(timer);
            timer = setTimeout(mark, MARK_DELAY_MS);
        });
        return () => {
            clearTimeout(timer);
            off();
            editor.setChangeMarks([], 'git');
        };
    }, [editor, base]);
}
