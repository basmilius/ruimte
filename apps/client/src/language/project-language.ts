import { fileUriToPath, type ApplyWorkspaceEditResult, type ContentChange, type LanguageService, type WorkspaceEdit } from '@ruimte/smart-editor-lsp';
import type { Editor } from '@ruimte/smart-editor';
import type { Transport } from '@/transport/transport';
import { LanguageStatusTracker } from './status';
import { WireLanguageService } from './wire-service';
import { applyWorkspaceEdit, type ProjectFiles } from './workspace-edit';

/* One file of a project as one editor holds it open, until `release`. */
export interface LanguageDocumentHandle {
    readonly uri: string;
    readonly service: LanguageService;
    /* Settles once the daemon has the document, with the changes made while it was opening. */
    readonly ready: Promise<void>;
    release(): void;
}

/*
 * Forwards one editor's changes to the daemon. The daemon takes a change against a version, so changes
 * made while the open is still in flight wait for it and go as one entry list the moment it is answered.
 */
class DocumentSync {
    readonly ready: Promise<void>;
    private pending: ContentChange[] = [];
    private opened = false;
    private readonly stop: () => void;

    private readonly service: LanguageService;
    private readonly uri: string;
    readonly editor: Editor;

    constructor(service: LanguageService, uri: string, languageId: string, editor: Editor) {
        this.service = service;
        this.uri = uri;
        this.editor = editor;
        this.stop = editor.onTextChange((change) => this.changed(change.changes));
        this.ready = service.openDocument({ uri, languageId, text: editor.getText() }).then(() => {
            this.opened = true;
            this.flush();
        });
        // A failed open is also a document nothing can be asked of; the features' own requests say so.
        this.ready.catch(() => undefined);
    }

    private changed(changes: readonly ContentChange[]): void {
        this.pending.push(...changes);
        if (this.opened) {
            this.flush();
        }
    }

    private flush(): void {
        if (this.pending.length === 0) {
            return;
        }
        const changes = this.pending;
        this.pending = [];
        void this.service.changeDocument(this.uri, changes).catch(() => undefined);
    }

    dispose(): void {
        this.stop();
    }

    get text(): string {
        return this.editor.getText();
    }
}

interface Holder {
    readonly editors: Editor[];
    sync: DocumentSync;
    languageId: string;
}

/*
 * The language side of one project on one machine, shared by every editor that has one of its files
 * open: the wire service, the status of the servers, and one set of documents. Two editors on the same
 * file hold one document, and only the first one sends changes, since both would report the same edit.
 */
export class ProjectLanguage {
    readonly service: WireLanguageService;
    readonly status: LanguageStatusTracker;
    /* The project folder on the machine of the daemon. */
    readonly folder: string;
    private readonly holders = new Map<string, Holder>();
    private readonly files: ProjectFiles | null;

    constructor(transport: Transport, projectId: string, folder: string, files: ProjectFiles | null = null) {
        this.folder = folder;
        this.files = files;
        this.status = new LanguageStatusTracker(transport, projectId);
        this.service = new WireLanguageService({
            transport,
            projectId,
            folder,
            textOf: (uri) => this.holders.get(uri)?.sync.text,
            applyEdit: (params) => this.applyWorkspaceEdit(params.edit)
        });
        void this.status.refresh().catch(() => undefined);
    }

    /* Makes an edit of a language server: an open document takes it as one undo step and any other file gets an unsaved draft. */
    applyWorkspaceEdit(edit: WorkspaceEdit): Promise<ApplyWorkspaceEditResult> {
        return applyWorkspaceEdit(edit, { editorOf: (uri) => this.holders.get(uri)?.editors[0], files: this.files });
    }

    /* The text of a file as it stands now: an open document's, else a draft's or the machine's; null when it is no text file. */
    async readText(uri: string): Promise<string | null> {
        const open = this.holders.get(uri)?.sync.text;
        if (open !== undefined) {
            return open;
        }
        const path = fileUriToPath(uri);
        return path === null || this.files === null ? null : ((await this.files.read(path))?.text ?? null);
    }

    /* Opens `uri` for the editor, or joins the editors that already hold it. */
    acquire(uri: string, languageId: string, editor: Editor): LanguageDocumentHandle {
        let holder = this.holders.get(uri);
        if (holder === undefined) {
            holder = { editors: [], sync: new DocumentSync(this.service, uri, languageId, editor), languageId };
            this.holders.set(uri, holder);
        }
        holder.editors.push(editor);
        let released = false;
        return {
            uri,
            service: this.service,
            get ready() {
                return holder.sync.ready;
            },
            release: () => {
                if (!released) {
                    released = true;
                    this.release(uri, editor);
                }
            }
        };
    }

    private release(uri: string, editor: Editor): void {
        const holder = this.holders.get(uri);
        if (holder === undefined) {
            return;
        }
        holder.editors.splice(holder.editors.indexOf(editor), 1);
        const next = holder.editors[0];
        if (next === undefined) {
            holder.sync.dispose();
            this.holders.delete(uri);
            void this.service.closeDocument(uri);
        } else if (holder.sync.editor === editor) {
            // The editor that sent the changes is gone; the next one takes over and opens the document with its own text.
            holder.sync.dispose();
            holder.sync = new DocumentSync(this.service, uri, holder.languageId, next);
        }
    }

    dispose(): void {
        for (const holder of this.holders.values()) {
            holder.sync.dispose();
        }
        this.holders.clear();
        this.service.dispose();
        this.status.dispose();
    }
}

interface Entry {
    language: ProjectLanguage;
    references: number;
}

const entries = new WeakMap<Transport, Map<string, Entry>>();

/* The project's language side, made on the first call and ended with the last release. */
export function acquireProjectLanguage(
    transport: Transport,
    projectId: string,
    folder: string,
    files: ProjectFiles | null = null
): { language: ProjectLanguage; release(): void } {
    let byProject = entries.get(transport);
    if (byProject === undefined) {
        byProject = new Map();
        entries.set(transport, byProject);
    }
    const key = `${projectId}\0${folder}`;
    let entry = byProject.get(key);
    if (entry === undefined) {
        entry = { language: new ProjectLanguage(transport, projectId, folder, files), references: 0 };
        byProject.set(key, entry);
    }
    entry.references += 1;
    const held = entry;
    let released = false;
    return {
        language: held.language,
        release: () => {
            if (released) {
                return;
            }
            released = true;
            held.references -= 1;
            if (held.references === 0) {
                byProject.delete(key);
                held.language.dispose();
            }
        }
    };
}
