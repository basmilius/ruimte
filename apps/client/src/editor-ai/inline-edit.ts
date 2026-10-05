import i18next from 'i18next';
import { createStore, type StoreApi } from 'zustand';
import { storedPathOf, type AgentKind } from '@ruimte/contracts';
import { fileUriToPath } from '@ruimte/smart-editor-lsp';
import type { EditorRange } from '@ruimte/smart-editor';
import { providersOf } from '@ruimte/agents-react/state/providers';
import { availableAgents } from '@/agents/creation';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { codeLabelOf, severityOf } from '@/language/diagnostics-model';
import type { EditorLanguage } from '@/language/editor-language';
import { shikiLanguageOf } from '@/language/language-ids';
import { isShortcut } from '@/language/shortcut-keys';
import { currentEndpointId } from '@/state/keys';
import { useProject } from '@/state/project';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { inlineEditDeps } from './inline-edit-deps';
import { inlineRangeOf, lineSpanOf, problemsOnLines, type InlineProblem, type LineSpan } from './inline-edit-model';
import { inlineEditFor } from './inline-edit-record';
import { sweepInlineEdits } from './inline-edit-prune';
import { InlineEditSession, inlineSessionOf, type InlineEditDeps } from './inline-edit-session';

const PLAIN_IDS = new Set(['plaintext', 'text']);
const WIDGET_OWNER = 'inline-edit';
/* The card as it first draws, until the editor has measured it: the header, a few lines of code and the follow-up row. */
const WIDGET_HEIGHT = 200;

/* The card that asks what to change, before there is anything to run. */
export interface InlinePrompt {
    readonly range: EditorRange;
    readonly selectedText: string;
    readonly span: LineSpan;
    readonly problems: readonly InlineProblem[];
    readonly provider: AgentKind;
    readonly model: string | null;
    readonly instruction: string;
}

export interface InlineEditView {
    readonly prompt: InlinePrompt | null;
    readonly session: InlineEditSession | null;
    /* The row the editor draws the proposal in; null until it has made one. */
    readonly container: HTMLElement | null;
}

/* The agent the setting names, or the first one installed when that one is not. */
export function inlineAgentNow(endpointId: string): { provider: AgentKind; model: string | null } {
    const wanted = useSettings.getState().aiInlineAgent;
    const offered = availableAgents(providersOf(endpointId).providers, 'chat');
    if (offered.length === 0 || offered.some((provider) => provider.kind === wanted.provider)) {
        return wanted;
    }
    return { provider: offered[0]!.kind, model: null };
}

/*
 * Mod+I: an instruction for the selected lines, answered by a chat that runs in the background, and the
 * answer as a proposal under the selection that only Apply writes into the file. The session behind it
 * (`inline-edit-session.ts`) outlives this editor; this class draws it while an editor holds the file.
 */
export class InlineEditFeature {
    readonly store: StoreApi<InlineEditView> = createStore<InlineEditView>(() => ({ prompt: null, session: null, container: null }));
    private readonly language: EditorLanguage;
    private readonly depsFor: (endpointId: string) => InlineEditDeps;
    private stopSession: (() => void) | null = null;

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
            editor.onTextChange(() => this.store.getState().session?.checkSelection())
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.release();
        });
        sweepInlineEdits(this.endpointId, {
            now: () => Date.now(),
            remove: (projectId, viewId) => this.depsFor(this.endpointId).removeChat(projectId, viewId)
        });
        const existing = inlineSessionOf(this.endpointId, this.path);
        if (existing !== null) {
            this.adopt(existing);
        }
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
        this.store.setState({
            prompt: { range, selectedText: editor.textInRange(range), span, problems, ...inlineAgentNow(this.endpointId), instruction: '' },
            session: null
        });
    }

    setInstruction(instruction: string): void {
        const { prompt } = this.store.getState();
        if (prompt !== null) {
            this.store.setState({ prompt: { ...prompt, instruction } });
        }
    }

    setAgent(provider: AgentKind, model: string): void {
        const { prompt } = this.store.getState();
        if (prompt !== null) {
            this.store.setState({ prompt: { ...prompt, provider, model } });
        }
    }

    cancel(focus = true): void {
        if (this.store.getState().prompt === null) {
            return;
        }
        this.store.setState({ prompt: null });
        if (focus) {
            this.language.editor.focus();
        }
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
            model: prompt.model
        });
        this.store.setState({ prompt: null });
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

    private adopt(session: InlineEditSession): void {
        this.release();
        session.attach(this.language.editor);
        this.store.setState({ session, prompt: null });
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
            this.store.setState({ session: null, container: null });
            this.stopSession?.();
            this.stopSession = null;
            return;
        }
        if (!state.shown) {
            editor.setWidgets([], WIDGET_OWNER);
            this.store.setState({ container: null });
            return;
        }
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
        }
    }
}
