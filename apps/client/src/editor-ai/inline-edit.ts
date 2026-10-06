import i18next from 'i18next';
import { createStore, type StoreApi } from 'zustand';
import { storedPathOf, type AgentKind } from '@ruimte/contracts';
import { fileUriToPath } from '@adecore/lsp';
import type { EditorRange, EditorTrackedRange } from '@adecore/editor';
import { knownAccounts, providerAccountsOf } from '@adecore/agents-react/state/provider-accounts';
import { providersOf } from '@adecore/agents-react/state/providers';
import { availableAgents } from '@/agents/creation';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { codeLabelOf, severityOf } from '@/language/diagnostics-model';
import type { HostLanguage as EditorLanguage } from '@/language/host-language';
import { shikiLanguageOf } from '@/language/language-ids-host';
import { isShortcut } from '@/language/shortcut-keys';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { inlineEditAccountOn } from '@/state/ai-settings';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { highlightLayers } from '@adecore/editor-react';
import { inlineEditDeps } from './inline-edit-deps';
import { inlineRangeOf, isEmptyRange, lineSpanOf, locateSelection, problemsOnLines, type InlineProblem, type LineSpan } from './inline-edit-model';
import { inlineEditFor, onInlineEditsChange } from './inline-edit-record';
import { sweepInlineEdits } from './inline-edit-prune';
import { InlineEditSession, inlineSessionOf, type InlineEditDeps } from './inline-edit-session';

const PLAIN_IDS = new Set(['plaintext', 'text']);
const WIDGET_OWNER = 'inline-edit';
const PROMPT_OWNER = 'inline-edit-prompt';
const MARKER_ID = 'inline-edit';
const TINT_OWNER = 'inline-edit';
/* The card as it first draws, until the editor has measured it: the header, a few lines of code and the follow-up row. */
const WIDGET_HEIGHT = 200;
/* The same for the question: the input, the row of chips and the padding around the card. */
const PROMPT_HEIGHT = 100;

/* The card that asks what to change, before there is anything to run. */
export interface InlinePrompt {
    readonly range: EditorRange;
    readonly selectedText: string;
    readonly span: LineSpan;
    readonly problems: readonly InlineProblem[];
    readonly provider: AgentKind;
    readonly model: string | null;
    /* Absent is the CLI's default account. */
    readonly account?: string;
    readonly instruction: string;
}

export interface InlineEditView {
    readonly prompt: InlinePrompt | null;
    /* The row above the selected lines the editor draws the question in; null until it has made one. */
    readonly promptContainer: HTMLElement | null;
    readonly session: InlineEditSession | null;
    /* The row the editor draws the proposal in; null until it has made one. */
    readonly container: HTMLElement | null;
}

/* The agent the setting names, or the first one installed when that one is not. */
export function inlineAgentNow(endpointId: string): { provider: AgentKind; model: string | null; account?: string } {
    const wanted = useSettings.getState().aiInlineAgent;
    const offered = availableAgents(providersOf(endpointId).providers, 'chat');
    if (offered.length === 0 || offered.some((provider) => provider.kind === wanted.provider)) {
        const account = inlineEditAccountOn(knownAccounts(providerAccountsOf(endpointId)), wanted.provider, wanted.account);
        return { provider: wanted.provider, model: wanted.model, ...(account === undefined ? {} : { account }) };
    }
    return { provider: offered[0]!.kind, model: null };
}

/*
 * Mod+I: an instruction for the selected lines, answered by a chat that runs in the background, and the
 * answer as a proposal under the selection that only Apply writes into the file. The session behind it
 * (`inline-edit-session.ts`) outlives this editor; this class draws it while an editor holds the file.
 */
export class InlineEditFeature {
    readonly store: StoreApi<InlineEditView> = createStore<InlineEditView>(() => ({ prompt: null, promptContainer: null, session: null, container: null }));
    private readonly language: EditorLanguage;
    private readonly depsFor: (endpointId: string) => InlineEditDeps;
    private stopSession: (() => void) | null = null;
    /* The saved edit's lines while no session holds them, so the mark in the gutter follows the text; `line` is where they last stood. */
    private recordTracked: { chatId: string; range: EditorTrackedRange | null; line: number } | null = null;
    /* Chats of sessions that ended here, whose record is still being removed and no longer earns a mark. */
    private readonly ended = new Set<string>();
    /* The selection was folded to a caret so the tint is the only mark on the lines, and goes back with the keyboard. */
    private selectionFolded = false;

    constructor(language: EditorLanguage, depsFor: (endpointId: string) => InlineEditDeps = inlineEditDeps) {
        this.language = language;
        this.depsFor = depsFor;
        const { editor } = language;
        const offs = [
            editor.onKeyDown((event) => {
                if (isShortcut(CANVAS_SHORTCUTS.inlineEdit, event)) {
                    this.start();
                    return true;
                }
                if (event.key === 'Escape' && this.store.getState().prompt !== null) {
                    this.cancel();
                    return true;
                }
                return false;
            }),
            // A press in the text puts the question away; the proposal stays, since it is tied to its lines.
            editor.onClick(() => {
                if (this.store.getState().prompt !== null) {
                    this.cancel(false);
                }
                return false;
            }),
            editor.onTextChange(() => {
                this.store.getState().session?.checkSelection();
                this.refreshMarker();
            }),
            editor.onGutterMarker((id) => {
                if (id === MARKER_ID) {
                    void this.show();
                }
            }),
            onInlineEditsChange(() => this.refreshMarker())
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.release();
            this.forgetRecordRange();
        });
        sweepInlineEdits(this.endpointId, {
            now: () => Date.now(),
            remove: (projectId, viewId) => this.depsFor(this.endpointId).removeChat(projectId, viewId)
        });
        const existing = inlineSessionOf(this.endpointId, this.path);
        if (existing !== null) {
            this.adopt(existing);
        }
        this.refreshMarker();
    }

    get path(): string {
        return fileUriToPath(this.language.uri) ?? this.language.uri;
    }

    private get endpointId(): string {
        return currentEndpointId();
    }

    /* Opens the question for the selected lines, or brings the edit this file already has back. */
    start(): void {
        const { session } = this.store.getState();
        if (session !== null) {
            session.show();
            return;
        }
        const { editor } = this.language;
        const text = editor.getText();
        const range = inlineRangeOf(editor.getSelection(), (line) => text.split('\n')[line]?.length ?? 0);
        const span = lineSpanOf(range);
        const problems = problemsOnLines(
            this.language.diagnostics.problems.map((problem) => problem.diagnostic),
            span,
            (diagnostic) => ({ severity: severityOf(diagnostic), message: diagnostic.message, code: codeLabelOf(diagnostic) })
        );
        this.store.setState({ session: null });
        this.setPrompt({ range, selectedText: editor.textInRange(range), span, problems, ...inlineAgentNow(this.endpointId), instruction: '' });
        // The selection and the tint would draw the lines twice over, so the selection steps aside while the card is up: the caret waits on the line above, which no tint covers.
        const selection = editor.getSelection();
        this.selectionFolded = !isEmptyRange(selection);
        if (this.selectionFolded) {
            const caret = { line: Math.max(0, selection.start.line - 1), character: 0 };
            editor.setSelection({ start: caret, end: caret });
        }
    }

    setInstruction(instruction: string): void {
        const { prompt } = this.store.getState();
        if (prompt !== null) {
            this.store.setState({ prompt: { ...prompt, instruction } });
        }
    }

    setAgent(provider: AgentKind, model: string | null, account?: string): void {
        const { prompt } = this.store.getState();
        if (prompt !== null) {
            const { account: _previous, ...rest } = prompt;
            this.store.setState({ prompt: { ...rest, provider, model, ...(account === undefined ? {} : { account }) } });
        }
    }

    cancel(focus = true): void {
        if (this.store.getState().prompt === null) {
            return;
        }
        if (focus) {
            this.returnToEditor();
        } else {
            this.selectionFolded = false;
        }
        this.setPrompt(null);
    }

    /* Gives the keyboard back to the text, with the lines selected again when the card had folded the selection. */
    returnToEditor(): void {
        const { editor } = this.language;
        const { prompt, session } = this.store.getState();
        const range = prompt?.range ?? session?.currentRange() ?? null;
        if (this.selectionFolded && range !== null && isEmptyRange(editor.getSelection())) {
            editor.setSelection(range);
        }
        this.selectionFolded = false;
        editor.focus();
    }

    /* Starts the chat for the question that is open. */
    run(): void {
        const { prompt } = this.store.getState();
        const project = useProject.getState().current;
        if (prompt === null || prompt.instruction.trim() === '' || project === null) {
            return;
        }
        const path = this.path;
        const language = PLAIN_IDS.has(this.language.languageId) ? null : shikiLanguageOf(this.language.languageId);
        const session = new InlineEditSession(this.endpointId, this.depsFor(this.endpointId), {
            projectId: project.projectId,
            path,
            storedPath: storedPathOf(project.folder, path),
            language,
            range: prompt.range,
            selectedText: prompt.selectedText,
            span: prompt.span,
            problems: prompt.problems,
            provider: prompt.provider,
            model: prompt.model,
            ...(prompt.account === undefined ? {} : { account: prompt.account })
        });
        this.setPrompt(null);
        this.adopt(session);
        void session.start(prompt.instruction);
    }

    /* The Code menu's Show Inline Edit: the edit of this file that is up, or the one this client kept before a reload. */
    async show(): Promise<void> {
        const live = this.store.getState().session ?? inlineSessionOf(this.endpointId, this.path);
        if (live !== null) {
            this.adopt(live);
            live.show();
            return;
        }
        const record = inlineEditFor(this.endpointId, this.path);
        const project = useProject.getState().current;
        if (record === null || project === null) {
            useToasts.getState().show({ kind: 'error', title: i18next.t('inline-edit:toast.none') });
            return;
        }
        const language = PLAIN_IDS.has(this.language.languageId) ? null : shikiLanguageOf(this.language.languageId);
        const session = InlineEditSession.fromRecord(
            this.endpointId,
            this.depsFor(this.endpointId),
            record,
            storedPathOf(project.folder, record.path),
            language
        );
        this.adopt(session);
        await session.restore();
    }

    /* Whether this file has an edit that Show Inline Edit would bring back. */
    get hasEdit(): boolean {
        return (
            this.store.getState().session !== null || inlineSessionOf(this.endpointId, this.path) !== null || inlineEditFor(this.endpointId, this.path) !== null
        );
    }

    /* The row the proposal is drawn in, which the editor makes again whenever it scrolls back into view. */
    private setContainer(container: HTMLElement | null): void {
        this.store.setState({ container });
    }

    /* Puts the question above its lines, or takes it away. */
    private setPrompt(prompt: InlinePrompt | null): void {
        this.store.setState({ prompt, ...(prompt === null ? { promptContainer: null } : {}) });
        this.language.editor.setWidgets(
            prompt === null
                ? []
                : [
                      {
                          id: 'prompt',
                          line: prompt.range.start.line,
                          placement: 'above',
                          height: PROMPT_HEIGHT,
                          render: (container) => this.store.setState({ promptContainer: container })
                      }
                  ],
            PROMPT_OWNER
        );
        this.updateTint();
    }

    /* The lines the question or the card is about, in the one set of tinted lines the editor has. */
    private updateTint(): void {
        const { prompt, session } = this.store.getState();
        const layers = highlightLayers(this.language.editor);
        if (prompt !== null) {
            const { span } = prompt;
            layers.set(TINT_OWNER, () => [tintOf(span)]);
        } else if (session !== null && session.store.getState().shown) {
            layers.set(TINT_OWNER, () => {
                const range = session.currentRange();
                return range === null ? [] : [tintOf(lineSpanOf(range))];
            });
        } else {
            layers.set(TINT_OWNER, null);
        }
    }

    /* The mark in the gutter for an edit that is saved and not on screen, on the first line of its range. */
    private refreshMarker(): void {
        const line = this.markerLine();
        this.language.editor.setGutterMarkers(line === null ? [] : [{ id: MARKER_ID, line, label: i18next.t('inline-edit:marker.show') }], WIDGET_OWNER);
    }

    private markerLine(): number | null {
        const { session } = this.store.getState();
        if (session !== null) {
            const state = session.store.getState();
            this.forgetRecordRange();
            return state.shown || state.closed ? null : (session.currentRange() ?? state.range).start.line;
        }
        const record = inlineEditFor(this.endpointId, this.path);
        if (record === null || this.ended.has(record.chatId)) {
            this.forgetRecordRange();
            return null;
        }
        const { editor } = this.language;
        if (this.recordTracked?.chatId !== record.chatId) {
            this.forgetRecordRange();
            const found = locateSelection(editor.getText(), record.range, record.selectedText);
            this.recordTracked = { chatId: record.chatId, range: found === null ? null : editor.trackRange(found), line: (found ?? record.range).start.line };
        }
        const now = this.recordTracked.range?.get() ?? null;
        if (now !== null) {
            this.recordTracked.line = now.start.line;
        }
        return this.recordTracked.line;
    }

    private forgetRecordRange(): void {
        this.recordTracked?.range?.dispose();
        this.recordTracked = null;
    }

    private adopt(session: InlineEditSession): void {
        this.release();
        session.attach(this.language.editor);
        this.setPrompt(null);
        this.store.setState({ session });
        const sync = (): void => this.sync(session);
        this.stopSession = session.store.subscribe((state, previous) => {
            if (state.shown !== previous.shown || state.closed !== previous.closed) {
                sync();
            }
        });
        sync();
    }

    /* Draws the card in the editor while the session wants it shown, and takes it away when it does not. */
    private sync(session: InlineEditSession): void {
        const { editor } = this.language;
        const state = session.store.getState();
        if (state.closed) {
            editor.setWidgets([], WIDGET_OWNER);
            if (session.chat !== null) {
                this.ended.add(session.chat);
            }
            this.store.setState({ session: null, container: null });
            this.stopSession?.();
            this.stopSession = null;
            this.updateTint();
            this.refreshMarker();
            return;
        }
        if (!state.shown) {
            editor.setWidgets([], WIDGET_OWNER);
            this.store.setState({ container: null });
            this.updateTint();
            this.refreshMarker();
            return;
        }
        this.updateTint();
        this.refreshMarker();
        const { range } = state;
        // A selection that ends at the start of a line did not take that line, so the card goes under the one before it.
        const line = range.end.character === 0 && range.end.line > range.start.line ? range.end.line - 1 : range.end.line;
        editor.setWidgets([{ id: 'card', line, height: WIDGET_HEIGHT, render: (container) => this.setContainer(container) }], WIDGET_OWNER);
    }

    /* The editor is going: the session goes on without it. */
    private release(): void {
        this.stopSession?.();
        this.stopSession = null;
        const { session } = this.store.getState();
        if (session !== null) {
            this.language.editor.setWidgets([], WIDGET_OWNER);
            session.detach();
            this.store.setState({ session: null, container: null });
            this.updateTint();
        }
    }
}

function tintOf(span: LineSpan) {
    return { startLine: span.startLine, endLine: span.endLine, color: '--accent', fill: '--editor-selection' };
}
