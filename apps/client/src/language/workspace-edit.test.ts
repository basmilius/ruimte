import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@ruimte/smart-editor/fake';
import type { WorkspaceEdit } from '@ruimte/smart-editor-lsp';
import type { DiskText } from '@/state/text-drafts';
import { applyWorkspaceEdit, type ProjectFiles, type StagedFile } from './workspace-edit';

const openUri = 'file:///work/app/src/a.ts';
const closedUri = 'file:///work/app/src/b.ts';
const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

function setup(closedText = 'let value = 2;\nuse(value);') {
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;', theme: 'light' });
    const staged: StagedFile[] = [];
    const reads: string[] = [];
    const files: ProjectFiles = {
        read: async (path): Promise<DiskText | null> => {
            reads.push(path);
            return path === '/work/app/src/b.ts' ? { text: closedText, mtime: 5 } : null;
        },
        stage: (batch) => staged.push(...batch)
    };
    const host = { editorOf: (uri: string) => (uri === openUri ? editor : undefined), files };
    return { editor, staged, reads, host };
}

describe('workspace edits', () => {
    test('applies the edits of an open document at once and stages the other files as drafts', async () => {
        const { editor, staged, host } = setup();
        const edit: WorkspaceEdit = {
            changes: {
                [openUri]: [
                    { range: range(0, 4, 9), newText: 'count' },
                    { range: range(1, 0, 5), newText: 'count' }
                ],
                [closedUri]: [
                    { range: range(0, 4, 9), newText: 'count' },
                    { range: range(1, 4, 9), newText: 'count' }
                ]
            }
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(editor.getText()).toBe('let count = 1;\ncount + 1;');
        expect(staged).toEqual([{ path: '/work/app/src/b.ts', disk: { text: 'let value = 2;\nuse(value);', mtime: 5 }, text: 'let count = 2;\nuse(count);' }]);
    });

    test('reads nothing for an open document and changes nothing when an edit does not fit', async () => {
        const { editor, staged, reads, host } = setup();
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: 3 }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(9, 0, 1), newText: 'x' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false });
        expect(reads).toEqual(['/work/app/src/b.ts']);
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
        expect(staged).toEqual([]);
    });

    test('refuses a file that is not text and the operations on files', async () => {
        const { host } = setup();
        const missing: WorkspaceEdit = { changes: { 'file:///work/app/src/c.ts': [{ range: range(0, 0, 0), newText: 'x' }] } };
        expect(await applyWorkspaceEdit(missing, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('cannot be read') });
        const rename: WorkspaceEdit = { documentChanges: [{ kind: 'rename', oldUri: openUri, newUri: closedUri }] };
        expect(await applyWorkspaceEdit(rename, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('not supported') });
    });

    test('refuses an edit of a read-only editor', async () => {
        const { editor, host } = setup();
        editor.setReadOnly(true);
        const edit: WorkspaceEdit = { changes: { [openUri]: [{ range: range(0, 4, 9), newText: 'count' }] } };
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false });
    });
});
