import { describe, expect, test } from 'bun:test';
import { FakeEditorEngine } from '@adecore/editor/fake';
import type { WorkspaceEdit } from '@adecore/lsp';
import type { DiskText } from '@/state/text-drafts';
import { applyWorkspaceEdit, type ProjectFiles, type StagedFile } from '@adecore/editor-react';

const openUri = 'file:///work/app/src/a.ts';
const closedUri = 'file:///work/app/src/b.ts';
const range = (line: number, start: number, end: number) => ({ start: { line, character: start }, end: { line, character: end } });

function setup(closedText = 'let value = 2;\nuse(value);') {
    const editor = new FakeEditorEngine().mount({} as HTMLElement, { text: 'let value = 1;\nvalue + 1;', theme: 'light' });
    const staged: StagedFile[] = [];
    const saved: StagedFile[] = [];
    const moves: Array<[string, string]> = [];
    const reads: string[] = [];
    const files: ProjectFiles = {
        read: async (path): Promise<DiskText | null> => {
            reads.push(path);
            return path === '/work/app/src/b.ts' ? { text: closedText, mtime: 5 } : null;
        },
        stage: (batch) => staged.push(...batch),
        save: async (batch) => {
            saved.push(...batch);
            return null;
        },
        rename: async (from, to) => {
            moves.push([from, to]);
            return null;
        }
    };
    const host = { editorOf: (uri: string) => (uri === openUri ? editor : undefined), files };
    return { editor, staged, saved, moves, reads, host };
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
        const create: WorkspaceEdit = { documentChanges: [{ kind: 'create', uri: closedUri }] };
        expect(await applyWorkspaceEdit(create, host)).toMatchObject({ applied: false, failureReason: expect.stringContaining('not supported') });
    });

    test('refuses an edit of a read-only editor', async () => {
        const { editor, host } = setup();
        editor.setReadOnly(true);
        const edit: WorkspaceEdit = { changes: { [openUri]: [{ range: range(0, 4, 9), newText: 'count' }] } };
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false });
    });
});

describe('workspace edits that move a file', () => {
    const movedUri = 'file:///work/app/src/Moved.ts';
    const move: WorkspaceEdit = {
        documentChanges: [
            { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
            { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
            { kind: 'rename', oldUri: openUri, newUri: movedUri }
        ]
    };

    test('edits the open file in its editor, saves the others through the machine, and moves the file last', async () => {
        const { editor, staged, saved, moves, host } = setup();
        const order: string[] = [];
        const files = host.files;
        const recording: ProjectFiles = {
            ...files,
            save: async (batch) => (order.push('save'), files.save(batch)),
            rename: async (from, to) => (order.push('rename'), files.rename(from, to))
        };
        expect(await applyWorkspaceEdit(move, { ...host, files: recording })).toEqual({ applied: true });
        expect(editor.getText()).toBe('let count = 1;\nvalue + 1;');
        expect(staged).toEqual([]);
        expect(saved).toEqual([{ path: '/work/app/src/b.ts', disk: { text: 'let value = 2;\nuse(value);', mtime: 5 }, text: 'let count = 2;\nuse(value);' }]);
        expect(moves).toEqual([['/work/app/src/a.ts', '/work/app/src/Moved.ts']]);
        expect(order).toEqual(['save', 'rename']);
    });

    test('moves a file nobody has open after the edits that were made to it at its old place', async () => {
        const { saved, moves, host } = setup();
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { kind: 'rename', oldUri: closedUri, newUri: movedUri },
                { textDocument: { uri: movedUri, version: null }, edits: [{ range: range(1, 4, 9), newText: 'count' }] }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toEqual({ applied: true });
        expect(saved.map((file) => [file.path, file.text])).toEqual([
            ['/work/app/src/b.ts', 'let count = 2;\nuse(value);'],
            ['/work/app/src/Moved.ts', 'let count = 2;\nuse(count);']
        ]);
        expect(moves).toEqual([['/work/app/src/b.ts', '/work/app/src/Moved.ts']]);
    });

    test('changes nothing when a text does not fit, so no file moves either', async () => {
        const { editor, saved, moves, host } = setup();
        const edit: WorkspaceEdit = {
            documentChanges: [
                { textDocument: { uri: openUri, version: null }, edits: [{ range: range(0, 4, 9), newText: 'count' }] },
                { textDocument: { uri: closedUri, version: null }, edits: [{ range: range(9, 0, 1), newText: 'x' }] },
                { kind: 'rename', oldUri: openUri, newUri: movedUri }
            ]
        };
        expect(await applyWorkspaceEdit(edit, host)).toMatchObject({ applied: false });
        expect(editor.getText()).toBe('let value = 1;\nvalue + 1;');
        expect([saved, moves]).toEqual([[], []]);
    });

    test('says why a file could not be saved or moved, and stops there', async () => {
        const { host } = setup();
        const failing = (reason: string, where: 'save' | 'rename'): ProjectFiles => ({ ...host.files, [where]: async () => reason });
        expect(await applyWorkspaceEdit(move, { ...host, files: failing('b.ts changed on disk', 'save') })).toEqual({
            applied: false,
            failureReason: 'b.ts changed on disk'
        });
        expect(await applyWorkspaceEdit(move, { ...host, files: failing('Moved.ts is taken', 'rename') })).toEqual({
            applied: false,
            failureReason: 'Moved.ts is taken'
        });
    });
});
