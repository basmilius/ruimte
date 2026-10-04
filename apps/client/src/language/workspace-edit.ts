import type { Editor, EditorContentChange } from '@ruimte/smart-editor';
import {
    fileUriToPath,
    minimalChange,
    planWorkspaceEdit,
    type ApplyWorkspaceEditResult,
    type DocumentSnapshot,
    type TextEdit,
    type WorkspaceEdit
} from '@ruimte/smart-editor-lsp';
import type { DiskText } from '@/state/text-drafts';

/* A file that changed without an editor of this project holding it: its new text waits as an unsaved draft. */
export interface StagedFile {
    readonly path: string;
    readonly disk: DiskText;
    readonly text: string;
}

export interface ProjectFiles {
    /* The text of a file that is no open document, as a draft holds it or the machine has it; null when it is not a text file. */
    read(path: string): Promise<DiskText | null>;
    /* Puts the new texts in the files' drafts and tells the person. Nothing is written to disk. */
    stage(files: readonly StagedFile[]): void;
}

export interface WorkspaceEditHost {
    /* The editor whose document this is, which takes the edit as one undo step. */
    editorOf(uri: string): Editor | undefined;
    readonly files: ProjectFiles | null;
}

function refused(failureReason: string): ApplyWorkspaceEditResult {
    return { applied: false, failureReason };
}

/* The text edits of an edit per document, as the entries a document has in it; null when it creates, renames or deletes a file. */
function entriesOf(edit: WorkspaceEdit): Map<string, TextEdit[][]> | null {
    const entries = new Map<string, TextEdit[][]>();
    const add = (uri: string, edits: TextEdit[]): void => {
        entries.set(uri, [...(entries.get(uri) ?? []), edits]);
    };
    for (const change of edit.documentChanges ?? []) {
        if ('kind' in change) {
            return null;
        }
        add(change.textDocument.uri, change.edits as TextEdit[]);
    }
    if (edit.documentChanges === undefined) {
        for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
            add(uri, edits);
        }
    }
    return entries;
}

function contentChangeOf(edit: TextEdit): EditorContentChange {
    return { range: edit.range, text: edit.newText };
}

function spanChange(before: string, after: string): EditorContentChange {
    const change = minimalChange(before, after);
    return { range: change.range!, text: change.text };
}

/*
 * Applies an LSP workspace edit on the client. A file an editor holds takes its edits as one undo step,
 * and any other file gets its new text as an unsaved draft that a person saves: nothing is written to
 * disk here. Creating, renaming and deleting files are refused for now. The edit is checked against
 * every text first, so one that does not fit changes nothing.
 */
export async function applyWorkspaceEdit(edit: WorkspaceEdit, host: WorkspaceEditHost): Promise<ApplyWorkspaceEditResult> {
    const entries = entriesOf(edit);
    if (entries === null) {
        return refused('Creating, renaming and deleting files is not supported yet');
    }
    const snapshots = new Map<string, DocumentSnapshot>();
    const disks = new Map<string, DiskText>();
    for (const uri of entries.keys()) {
        const editor = host.editorOf(uri);
        if (editor) {
            snapshots.set(uri, { text: editor.getText(), version: null });
            continue;
        }
        const path = fileUriToPath(uri);
        const disk = path === null || host.files === null ? null : await host.files.read(path);
        if (disk === null) {
            return refused(`${uri} cannot be read as text`);
        }
        disks.set(uri, disk);
        snapshots.set(uri, { text: disk.text, version: null });
    }
    let planned;
    try {
        planned = planWorkspaceEdit(
            { documentChanges: [...entries].flatMap(([uri, list]) => list.map((edits) => ({ textDocument: { uri, version: null }, edits }))) },
            snapshots
        );
    } catch (error) {
        return refused(error instanceof Error ? error.message : String(error));
    }
    const staged: StagedFile[] = [];
    for (const plan of planned) {
        if (plan.text === plan.before) {
            continue;
        }
        const editor = host.editorOf(plan.uri);
        if (editor) {
            const list = entries.get(plan.uri) ?? [];
            // One entry keeps the edits apart, so the caret and what is drawn over the text stay where they were between them.
            const changes = list.length === 1 ? list[0]!.map(contentChangeOf) : [spanChange(plan.before, plan.text)];
            if (!editor.applyEdits(changes)) {
                return refused(`${plan.uri} is read only`);
            }
            continue;
        }
        const path = fileUriToPath(plan.uri);
        const disk = disks.get(plan.uri);
        if (path !== null && disk !== undefined) {
            staged.push({ path, disk, text: plan.text });
        }
    }
    if (staged.length > 0) {
        host.files?.stage(staged);
    }
    return { applied: true };
}
