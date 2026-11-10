import type { Editor } from '@adecore/editor';
import type { FileLocation } from '@ruimte/contracts';

export function revealLocation(editor: Editor, location: Omit<FileLocation, 'path'>): void {
    if (location.line === undefined) {
        return;
    }
    const start = editor.positionAt(editor.offsetAt({ line: location.line - 1, character: (location.column ?? 1) - 1 }));
    const end = location.endLine === undefined ? start : editor.positionAt(editor.offsetAt({ line: location.endLine - 1, character: Number.MAX_SAFE_INTEGER }));
    editor.setSelection({ start, end }, 'center');
}
