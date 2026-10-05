import type { Editor, EditorContentChange } from '@ruimte/smart-editor';
import { applyTextEdits, fileUriToPath, type ApplyWorkspaceEditResult, type RenameFile, type TextEdit, type WorkspaceEdit } from '@ruimte/smart-editor-lsp';
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
    /* Writes the new texts through the machine; the reason of the first file that could not be saved, or null. */
    save(files: readonly StagedFile[]): Promise<string | null>;
    /* Moves a file or folder on the machine, with what is open on it, and tells the servers it moved; the reason it could not, or null. */
    rename(from: string, to: string): Promise<string | null>;
}

export interface WorkspaceEditHost {
    /* The editor whose document this is, which takes the edit as one undo step. */
    editorOf(uri: string): Editor | undefined;
    readonly files: ProjectFiles | null;
}

function refused(failureReason: string): ApplyWorkspaceEditResult {
    return { applied: false, failureReason };
}

/* One thing an edit does, in the order it says: text edits of a document, or a file that moves. */
type Step =
    | { readonly kind: 'edits'; readonly uri: string; readonly edits: TextEdit[] }
    | { readonly kind: 'rename'; readonly oldUri: string; readonly newUri: string };

/* The steps of an edit; null when it creates or deletes a file, which an edit is not applied with. */
function stepsOf(edit: WorkspaceEdit): Step[] | null {
    const steps: Step[] = [];
    for (const change of edit.documentChanges ?? []) {
        if ('textDocument' in change) {
            steps.push({ kind: 'edits', uri: change.textDocument.uri, edits: change.edits });
        } else if (change.kind === 'rename') {
            steps.push({ kind: 'rename', oldUri: change.oldUri, newUri: change.newUri });
        } else {
            return null;
        }
    }
    if (edit.documentChanges === undefined) {
        for (const [uri, edits] of Object.entries(edit.changes ?? {})) {
            steps.push({ kind: 'edits', uri, edits });
        }
    }
    return steps;
}

/* The text edits of an edit per document, as the entries a document has in it; null when it creates or deletes a file. */
export function entriesOf(edit: WorkspaceEdit): Map<string, TextEdit[][]> | null {
    const steps = stepsOf(edit);
    if (steps === null) {
        return null;
    }
    const entries = new Map<string, TextEdit[][]>();
    for (const step of steps) {
        if (step.kind === 'edits') {
            entries.set(step.uri, [...(entries.get(step.uri) ?? []), step.edits]);
        }
    }
    return entries;
}

/* The files an edit moves, which a preview of lines cannot show. */
export function renamesOf(edit: WorkspaceEdit): RenameFile[] {
    return (edit.documentChanges ?? []).filter((change): change is RenameFile => 'kind' in change && change.kind === 'rename');
}

function contentChangeOf(edit: TextEdit): EditorContentChange {
    return { range: edit.range, text: edit.newText };
}

/* What a step of text edits does to one document, worked out before anything changes. */
interface PlannedEdits {
    readonly kind: 'edits';
    readonly uri: string;
    readonly edits: TextEdit[];
    readonly before: string;
    readonly after: string;
    /* Set when no editor holds the document: what the machine has, which the new text is a draft of. */
    readonly disk: DiskText | null;
}

type Planned = PlannedEdits | { readonly kind: 'rename'; readonly oldPath: string; readonly newPath: string };

/*
 * Applies an LSP workspace edit on the client, step by step in the order it says. A file an editor holds takes
 * its edits as one undo step. Any other file gets its new text as an unsaved draft that a person saves, and
 * nothing is written to disk on a server's word alone, unless the edit also moves a file: the edits and the
 * move are then one change, so every file is saved through the machine and the move is made there. The
 * edit is checked against every text first, so one that does not fit changes nothing.
 */
export async function applyWorkspaceEdit(edit: WorkspaceEdit, host: WorkspaceEditHost): Promise<ApplyWorkspaceEditResult> {
    const steps = stepsOf(edit);
    if (steps === null) {
        return refused('Creating and deleting files is not supported yet');
    }
    const planned = await plan(steps, host);
    if (typeof planned === 'string') {
        return refused(planned);
    }
    const moving = planned.some((item) => item.kind === 'rename');
    const staged: StagedFile[] = [];
    for (const item of planned) {
        if (item.kind === 'rename') {
            const reason = await host.files!.rename(item.oldPath, item.newPath);
            if (reason !== null) {
                return refused(reason);
            }
            continue;
        }
        if (item.after === item.before) {
            continue;
        }
        const editor = host.editorOf(item.uri);
        if (editor) {
            // The edits stay apart, so the caret and what is drawn over the text stay where they were between them.
            if (!editor.applyEdits(item.edits.map(contentChangeOf))) {
                return refused(`${item.uri} is read only`);
            }
            continue;
        }
        const path = fileUriToPath(item.uri);
        if (path === null || item.disk === null) {
            continue;
        }
        const file = { path, disk: item.disk, text: item.after };
        if (!moving) {
            staged.push(file);
            continue;
        }
        const reason = await host.files!.save([file]);
        if (reason !== null) {
            return refused(reason);
        }
    }
    if (staged.length > 0) {
        host.files?.stage(staged);
    }
    return { applied: true };
}

/* Reads every text the edit needs and works out what each step leaves, or says why it does not fit. */
async function plan(steps: readonly Step[], host: WorkspaceEditHost): Promise<Planned[] | string> {
    const texts = new Map<string, { text: string; disk: DiskText | null }>();
    // A file that has moved is read where it still stands: nothing moves until the plan is made.
    const origins = new Map<string, string>();
    const planned: Planned[] = [];
    for (const step of steps) {
        if (step.kind === 'rename') {
            const oldPath = fileUriToPath(step.oldUri);
            const newPath = fileUriToPath(step.newUri);
            if (oldPath === null || newPath === null || host.files === null) {
                return `${step.oldUri} cannot be moved from here`;
            }
            origins.set(step.newUri, origins.get(step.oldUri) ?? step.oldUri);
            planned.push({ kind: 'rename', oldPath, newPath });
            continue;
        }
        const source = origins.get(step.uri) ?? step.uri;
        if (!texts.has(source)) {
            const editor = host.editorOf(source);
            if (editor) {
                texts.set(source, { text: editor.getText(), disk: null });
            } else {
                const path = fileUriToPath(source);
                const disk = path === null || host.files === null ? null : await host.files.read(path);
                if (disk === null) {
                    return `${source} cannot be read as text`;
                }
                texts.set(source, { text: disk.text, disk });
            }
        }
        const held = texts.get(source)!;
        let after: string;
        try {
            after = applyTextEdits(held.text, step.edits);
        } catch (error) {
            return error instanceof Error ? error.message : String(error);
        }
        planned.push({ kind: 'edits', uri: step.uri, edits: step.edits, before: held.text, after, disk: held.disk });
        texts.set(source, { text: after, disk: held.disk });
    }
    return planned;
}
