import type { Editor } from '@ruimte/smart-editor';
import { fileUriToPath, type Location } from '@ruimte/smart-editor-lsp';
import { openFileLink } from '@/shell/panels/file-links';
import { CompletionFeature } from './completion';
import { DiagnosticsFeature } from './diagnostics';
import type { Problem } from './diagnostics-model';
import { HoverFeature } from './hover';
import { createPopupStore } from './popups';
import { realTimers, type Timers } from './timers';
import { InlayHintsFeature } from './inlay-hints';
import { SemanticTokensFeature } from './semantic-tokens';
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
    /* What the features of this editor have open over it: the hover card, the suggestions, the signature. */
    readonly popups = createPopupStore();
    readonly diagnostics: DiagnosticsFeature;
    readonly hover: HoverFeature;
    readonly completion: CompletionFeature;
    /* What the Quick fix button of a problem calls; the code actions fill it in, and the button stays off until they do. */
    quickFix: ((problem: Problem) => void) | null = null;
    private readonly disposers: Array<() => void> = [];
    private disposed = false;

    constructor(project: ProjectLanguage, editor: Editor, uri: string, languageId: string, timers: Timers = realTimers) {
        this.editor = editor;
        this.project = project;
        this.languageId = languageId;
        this.document = project.acquire(uri, languageId, editor);
        this.diagnostics = new DiagnosticsFeature(this);
        this.hover = new HoverFeature(this, timers);
        this.completion = new CompletionFeature(this, timers);
        new SemanticTokensFeature(this, timers);
        new InlayHintsFeature(this, timers);
    }

    get uri(): string {
        return this.document.uri;
    }

    get isDisposed(): boolean {
        return this.disposed;
    }

    /* Takes the caret to a place the servers named, in this file or in another one that opens beside it. */
    goTo(location: Location): void {
        if (location.uri === this.uri) {
            this.editor.setCaret(location.range.start);
            this.editor.focus();
            return;
        }
        const path = fileUriToPath(location.uri);
        if (path !== null) {
            void openFileLink(this.project.folder, { path, line: location.range.start.line + 1, directory: false });
        }
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
