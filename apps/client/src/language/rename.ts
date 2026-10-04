import i18next from 'i18next';
import { StaleResultError, type PrepareRenameResult, type WorkspaceEdit } from '@ruimte/smart-editor-lsp';
import type { EditorRange } from '@ruimte/smart-editor';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { useToasts } from '@/state/toasts';
import type { EditorLanguage } from './editor-language';
import type { RenameView } from './popups';
import { occurrencesOf, renamePreviewOf, renameTargetOf, wordRangeAt, type RenameTarget } from './rename-model';
import { isShortcut } from './shortcut-keys';

const METHOD = 'textDocument/rename';
const TOAST_ID = 'language-rename';

function say(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`panels:language.rename.${key}`, options);
}

function tell(kind: 'success' | 'error', title: string): void {
    useToasts.getState().show({ id: TOAST_ID, kind, title });
}

interface Session {
    readonly target: RenameTarget;
    readonly original: string;
    /* Set once the preview asked for the edit, so Enter applies exactly what was shown. */
    edit: WorkspaceEdit | null;
}

/*
 * Renaming a symbol. The input sits on the symbol itself, every place the name has lights up while the
 * new one is typed, Enter applies the server's edit at once and Shift+Enter lists what it would change first.
 * Edits to other files land as unsaved drafts (`applyWorkspaceEdit`), so nothing is written to disk here.
 */
export class RenameFeature {
    private readonly language: EditorLanguage;
    private session: Session | null = null;

    constructor(language: EditorLanguage) {
        this.language = language;
        const { editor } = language;
        const offs = [
            editor.onKeyDown((event) => {
                if (!isShortcut(CANVAS_SHORTCUTS.rename, event)) {
                    return false;
                }
                void this.start();
                return true;
            }),
            editor.onTextChange(() => this.cancel())
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.cancel();
        });
    }

    get isOpen(): boolean {
        return this.session !== null;
    }

    async start(): Promise<void> {
        const { editor, project, uri } = this.language;
        if (!project.service.supports(METHOD, uri)) {
            tell('error', say('unavailable'));
            return;
        }
        this.cancel();
        const caret = editor.getCaret();
        const prepare = project.service.providerOptions(METHOD, uri)?.prepareProvider === true;
        let answer: PrepareRenameResult;
        try {
            answer = prepare ? await project.service.prepareRename(uri, caret) : { defaultBehavior: true };
        } catch (error) {
            if (!(error instanceof StaleResultError)) {
                tell('error', say('nothing'));
            }
            return;
        }
        const target = renameTargetOf(
            answer,
            (range) => editor.textInRange(range),
            () =>
                wordRangeAt(
                    editor.textInRange({ start: { line: caret.line, character: 0 }, end: { line: caret.line, character: Number.MAX_SAFE_INTEGER } }),
                    caret
                )
        );
        if (target === null) {
            tell('error', say('nothing'));
            return;
        }
        const session: Session = { target, original: editor.textInRange(target.range), edit: null };
        this.session = session;
        this.publish({ phase: 'input', busy: false, name: target.placeholder, files: [], occurrences: null });
        void this.light(session);
    }

    /* The name was typed: Enter applies it, Shift+Enter lists what it would change first. */
    async submit(name: string, preview: boolean): Promise<void> {
        const session = this.session;
        const next = name.trim();
        if (session === null) {
            return;
        }
        if (next === '' || next === session.original) {
            this.finish();
            return;
        }
        this.publish({ phase: 'input', busy: true, name: next, error: null });
        const { project, uri } = this.language;
        try {
            const edit = await project.service.rename(uri, session.target.range.start, next);
            if (this.session !== session) {
                return;
            }
            if (edit === null) {
                this.fail(say('refused'));
                return;
            }
            session.edit = edit;
            if (!preview) {
                await this.apply(session);
                return;
            }
            const files = await renamePreviewOf(edit, (target) => project.readText(target));
            if (this.session !== session) {
                return;
            }
            if (files === null) {
                // An edit that renames files too has no list of lines to show, so it is applied or refused as a whole.
                await this.apply(session);
                return;
            }
            this.publish({ phase: 'preview', busy: false, name: next, files });
        } catch (error) {
            if (this.session === session) {
                this.fail(error instanceof StaleResultError ? say('stale') : error instanceof Error ? error.message : String(error));
            }
        }
    }

    /* Applies the edit the preview showed. */
    async confirm(): Promise<void> {
        const session = this.session;
        if (session?.edit) {
            await this.apply(session);
        }
    }

    cancel(): void {
        if (this.session === null) {
            return;
        }
        this.finish();
    }

    private async apply(session: Session): Promise<void> {
        const result = await this.language.project.applyWorkspaceEdit(session.edit!);
        if (this.session !== session) {
            return;
        }
        if (result.applied) {
            this.finish();
        } else {
            this.fail(result.failureReason ?? say('refused'));
        }
    }

    /* The input stays, with the reason under it, so the name can be changed and tried again. */
    private fail(message: string): void {
        if (this.session !== null) {
            this.session.edit = null;
            this.publish({ phase: 'input', busy: false, files: [], error: say('failed', { message }) });
        }
    }

    /* The name was changed, which answers the failure under it. */
    edited(): void {
        if (this.language.popups.getState().rename?.error != null) {
            this.publish({ error: null });
        }
    }

    private finish(): void {
        this.session = null;
        const { editor, popups } = this.language;
        popups.setState({ rename: null });
        editor.setHighlights([]);
        editor.focus();
    }

    /* Lights up the places the name has in this file, and counts them all. */
    private async light(session: Session): Promise<void> {
        const { editor, project, uri } = this.language;
        if (!project.service.supports('textDocument/references', uri)) {
            return;
        }
        try {
            const locations = await project.service.references(uri, session.target.range.start, true);
            if (this.session !== session || locations === null) {
                return;
            }
            const found = occurrencesOf(locations, uri);
            editor.setHighlights(found.inFile.map((range: EditorRange) => ({ range, kind: 'write' as const })));
            this.publish({ occurrences: { count: found.count, files: found.files } });
        } catch {
            // The count is a courtesy; renaming does not wait for it.
        }
    }

    private publish(patch: Partial<RenameView>): void {
        const session = this.session;
        if (session === null) {
            return;
        }
        const { popups } = this.language;
        const current = popups.getState().rename;
        popups.setState({
            rename: {
                phase: 'input',
                range: session.target.range,
                original: session.original,
                placeholder: session.target.placeholder,
                occurrences: null,
                busy: false,
                error: null,
                name: session.target.placeholder,
                files: [],
                ...current,
                ...patch
            }
        });
    }
}
