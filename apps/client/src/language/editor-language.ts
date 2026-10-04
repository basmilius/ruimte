import type { Editor } from '@ruimte/smart-editor';
import type { LanguageDocumentHandle, ProjectLanguage } from './project-language';

/*
 * The one place that connects an editor to the language servers: it opens the file's document for
 * the editor and lets go of it again. Every language feature of the editor hangs off this object.
 */
export class EditorLanguage {
    readonly editor: Editor;
    readonly project: ProjectLanguage;
    readonly document: LanguageDocumentHandle;
    readonly languageId: string;
    private readonly disposers: Array<() => void> = [];
    private disposed = false;

    constructor(project: ProjectLanguage, editor: Editor, uri: string, languageId: string) {
        this.editor = editor;
        this.project = project;
        this.languageId = languageId;
        this.document = project.acquire(uri, languageId, editor);
    }

    get uri(): string {
        return this.document.uri;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    /* Runs `dispose` when the editor lets go of its document. */
    onDispose(dispose: () => void): void {
        this.disposers.push(dispose);
    }

    dispose(): void {
        if (this.disposed) {
            return;
        }
        this.disposed = true;
        for (const dispose of this.disposers.splice(0).reverse()) {
            dispose();
        }
        this.document.release();
    }
}
