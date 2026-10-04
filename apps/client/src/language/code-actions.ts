import i18next from 'i18next';
import { StaleResultError, type CodeAction, type Diagnostic } from '@ruimte/smart-editor-lsp';
import type { EditorPosition, EditorRange } from '@ruimte/smart-editor';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { useToasts } from '@/state/toasts';
import { ACTION_GROUPS, actionsOf, diagnosticsAt, fixableOnLine, isHint, mergeEntries, previewOf, type ActionEntry } from './code-actions-model';
import type { Problem } from './diagnostics-model';
import type { EditorLanguage } from './editor-language';
import type { PickGroup, PickPreview } from './popups';
import { Refresher } from './refresher';
import { isShortcut } from './shortcut-keys';
import { realTimers, type Timers } from './timers';

const METHOD = 'textDocument/codeAction';
const PAUSE_MS = 250;
const INVOKED = 1;
const AUTOMATIC = 2;
const TOAST_ID = 'language-action';
/* How many problems of the line are asked for their fixes besides the caret's own request. */
const LINE_PROBLEMS = 3;

interface AskOptions {
    readonly range: EditorRange;
    readonly only?: readonly string[];
    readonly anchor: EditorPosition;
    /* The problems the actions are about; the ones touching the range when absent. */
    readonly diagnostics?: readonly Diagnostic[];
    /* Also the fixes of a problem on the line when none touches the range. */
    readonly withLine?: boolean;
}

function say(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`panels:language.actions.${key}`, options);
}

function tell(kind: 'success' | 'error', title: string): void {
    useToasts.getState().show({ id: TOAST_ID, kind, title });
}

/*
 * What the language servers offer to do at the caret or the selection: a lightbulb in the gutter on the line
 * that has something, a list under the caret (Mod+.) grouped by kind with the change an action would make
 * shown under it, the Quick fix of a problem's card, and the commands that organize imports and format the file.
 * An action is resolved before it is applied, since a server fills in its edit only when asked for it.
 */
export class CodeActionsFeature {
    private readonly language: EditorLanguage;
    private readonly refresher: Refresher;
    /* While a list is being asked for, the lightbulb waits: both are the same request and the newer one would cancel the older. */
    private asking = false;
    private readonly resolved = new Map<ActionEntry, CodeAction>();

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        const { editor, project, uri } = language;
        this.refresher = new Refresher((signal) => this.hint(signal), PAUSE_MS, timers);
        const providers = project.service.onProvidersChanged((changed) => {
            if (changed === uri) {
                this.refresher.later();
            }
        });
        const offs = [
            editor.onCaret(() => {
                editor.setGutterAction(null);
                this.refresher.later();
            }),
            editor.onTextChange(() => editor.setGutterAction(null)),
            editor.onGutterAction(() => void this.open()),
            editor.onKeyDown((event) => {
                if (!isShortcut(CANVAS_SHORTCUTS.codeActions, event)) {
                    return false;
                }
                void this.open();
                return true;
            }),
            language.diagnostics.onChange(() => this.refresher.later()),
            () => providers.dispose()
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.refresher.dispose();
            editor.setGutterAction(null);
        });
    }

    get supported(): boolean {
        return this.language.project.service.supports(METHOD, this.language.uri);
    }

    /* The list under the caret, or under the selection's start. */
    open(): Promise<void> {
        const range = this.language.editor.getSelection();
        return this.ask({ range, anchor: range.start, withLine: true });
    }

    /* The quick fixes of one problem, under it, as the Quick fix button of its card asks. */
    quickFixFor(problem: Problem): Promise<void> {
        const { range } = problem.diagnostic;
        return this.ask({ range, only: ['quickfix'], anchor: range.start, diagnostics: [problem.diagnostic] });
    }

    async organizeImports(): Promise<void> {
        const { editor } = this.language;
        const everything = { start: { line: 0, character: 0 }, end: editor.positionAt(Number.MAX_SAFE_INTEGER) };
        const entries = await this.request(everything, ['source.organizeImports'], INVOKED);
        const entry = entries?.find((candidate) => candidate.action.kind?.startsWith('source.organizeImports') === true);
        if (entry === undefined) {
            tell('success', say(entries === null ? 'unavailable' : 'organized'));
            return;
        }
        await this.apply(entry);
    }

    async formatDocument(): Promise<void> {
        const { editor, project, uri } = this.language;
        if (!project.service.supports('textDocument/formatting', uri)) {
            tell('error', say('noFormatter'));
            return;
        }
        try {
            const edits = await project.service.formatting(uri, { ...editor.getIndentation() });
            if (edits !== null && edits.length > 0 && !editor.applyEdits(edits.map((edit) => ({ range: edit.range, text: edit.newText })))) {
                tell('error', say('readOnly'));
            }
        } catch (error) {
            this.fail(error);
        }
    }

    /* The actions of one kind for the selection, as entries a menu can list and `apply` runs. */
    list(only: readonly string[]): Promise<ActionEntry[] | null> {
        return this.supported ? this.request(this.language.editor.getSelection(), only, AUTOMATIC) : Promise.resolve(null);
    }

    private async ask(options: AskOptions): Promise<void> {
        if (!this.supported) {
            tell('error', say('unavailable'));
            return;
        }
        // The press on a card or the gutter may have taken the focus, and the list answers to the editor's keys.
        this.language.editor.focus();
        this.asking = true;
        let entries: ActionEntry[] | null;
        try {
            entries = options.withLine
                ? await this.requestWithLine(options.range, INVOKED)
                : await this.request(options.range, options.only, INVOKED, undefined, options.diagnostics);
        } finally {
            this.asking = false;
        }
        if (entries === null) {
            return;
        }
        if (entries.length === 0) {
            tell('success', say('none'));
            return;
        }
        const byId = new Map(entries.map((entry) => [entry.id, entry]));
        const groups: PickGroup[] = ACTION_GROUPS.flatMap((group): PickGroup[] => {
            const rows = entries.filter((entry) => entry.group === group).map((entry) => ({ id: entry.id, label: entry.action.title, detail: '' }));
            return rows.length === 0 ? [] : [{ title: say(`groups.${group}`), rows }];
        });
        this.language.completion.close();
        this.language.pick.open({
            anchor: options.anchor,
            groups,
            accept: (id) => {
                const entry = byId.get(id);
                if (entry !== undefined) {
                    void this.apply(entry);
                }
            },
            preview: (id, signal) => this.preview(byId.get(id), signal)
        });
    }

    /* Asks the servers; null when they could not answer, with the reason said aloud for a request a person made. */
    private async request(
        range: EditorRange,
        only: readonly string[] | undefined,
        triggerKind: number,
        signal?: AbortSignal,
        about?: readonly Diagnostic[]
    ): Promise<ActionEntry[] | null> {
        const { project, uri, diagnostics } = this.language;
        try {
            const context = {
                diagnostics: [
                    ...(about ??
                        diagnosticsAt(
                            diagnostics.problems.map((problem) => problem.diagnostic),
                            range
                        ))
                ],
                ...(only ? { only: [...only] } : {}),
                triggerKind: triggerKind as 1 | 2
            };
            const entries = actionsOf(await project.service.codeActions(uri, range, context, { signal }));
            // A server may answer with more than the kinds asked for.
            return only ? entries.filter((entry) => only.some((kind) => entry.action.kind === kind || entry.action.kind?.startsWith(`${kind}.`))) : entries;
        } catch (error) {
            if (triggerKind === INVOKED) {
                this.fail(error);
            }
            return null;
        }
    }

    /*
     * What the servers offer at the range, and when no problem touches it, the quick fixes of the problems
     * elsewhere on its line too, since the fix of an error is wanted from anywhere on the line it is on.
     */
    private async requestWithLine(range: EditorRange, triggerKind: number, signal?: AbortSignal): Promise<ActionEntry[] | null> {
        const entries = await this.request(range, undefined, triggerKind, signal);
        if (entries === null || range.start.line !== range.end.line) {
            return entries;
        }
        const all = this.language.diagnostics.problems.map((problem) => problem.diagnostic);
        if (diagnosticsAt(all, range).length > 0) {
            return entries;
        }
        const onLine = fixableOnLine(all, range.start.line).slice(0, LINE_PROBLEMS);
        const fixes = await Promise.all(onLine.map((diagnostic) => this.request(diagnostic.range, ['quickfix'], triggerKind, signal, [diagnostic])));
        return mergeEntries([entries, ...fixes.map((list) => list ?? [])]);
    }

    private async hint(signal: AbortSignal): Promise<void> {
        const { editor } = this.language;
        if (this.asking || !this.supported) {
            editor.setGutterAction(null);
            return;
        }
        const range = editor.getSelection();
        const entries = await this.requestWithLine(range, AUTOMATIC, signal);
        if (signal.aborted || this.asking) {
            return;
        }
        editor.setGutterAction(entries?.some(isHint) === true ? { line: editor.getCaret().line, label: say('show') } : null);
    }

    private async resolve(entry: ActionEntry, signal?: AbortSignal): Promise<CodeAction> {
        const known = this.resolved.get(entry);
        if (known !== undefined) {
            return known;
        }
        const { project, uri } = this.language;
        const { action } = entry;
        let result = action;
        if (action.edit === undefined && project.service.providerOptions(METHOD, uri)?.resolveProvider === true) {
            try {
                result = await project.service.resolveCodeAction(uri, action, { signal });
            } catch (error) {
                // An action the server cannot resolve is still tried as it is, unless the text moved under it.
                if (error instanceof StaleResultError) {
                    throw error;
                }
            }
        }
        this.resolved.set(entry, result);
        return result;
    }

    private async preview(entry: ActionEntry | undefined, signal: AbortSignal): Promise<PickPreview | null> {
        if (entry === undefined) {
            return null;
        }
        const action = await this.resolve(entry, signal);
        const { editor, uri } = this.language;
        const found = action.edit === undefined ? null : previewOf(editor.getText(), action.edit, uri);
        if (found === null) {
            return null;
        }
        const notes = [
            ...(found.hiddenLines > 0 ? [say('moreLines', { count: found.hiddenLines })] : []),
            ...(found.otherFiles > 0 ? [say('otherFiles', { count: found.otherFiles })] : [])
        ];
        return { removed: found.removed, added: found.added, note: notes.length === 0 ? null : notes.join(' · ') };
    }

    /* Resolves the action, makes its edit as one undo step, and then runs its command. */
    async apply(entry: ActionEntry): Promise<void> {
        const { editor, project, uri } = this.language;
        try {
            const action = await this.resolve(entry);
            if (action.edit !== undefined) {
                const result = await project.applyWorkspaceEdit(action.edit);
                if (!result.applied) {
                    tell('error', say('failed', { message: result.failureReason ?? say('refused') }));
                    return;
                }
            }
            if (action.command !== undefined) {
                await project.service.executeCommand(uri, action.command);
            }
        } catch (error) {
            this.fail(error);
        } finally {
            this.resolved.delete(entry);
            editor.focus();
        }
    }

    private fail(error: unknown): void {
        if (!(error instanceof StaleResultError)) {
            tell('error', say('failed', { message: error instanceof Error ? error.message : String(error) }));
        }
    }
}
