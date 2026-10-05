import i18next from 'i18next';
import { storedPathOf, type AgentKind } from '@ruimte/contracts';
import { fileUriToPath } from '@ruimte/smart-editor-lsp';
import type { EditorRange } from '@ruimte/smart-editor';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { lineRangeLabel, offerSelection, selectionBlock, startLinkedChatOrTell, type SelectionOffer } from '@/chat/selection-to-chat';
import { basenameOf } from '@/shell/panels/files-tree';
import { useProject } from '@/state/project';
import type { EditorLanguage } from './editor-language';
import type { Problem } from './diagnostics-model';
import { shikiLanguageOf } from './language-ids';
import { isShortcut } from './shortcut-keys';

const PLAIN_IDS = new Set(['plaintext', 'text']);

/*
 * Sends code from the editor to a chat's prompt: the selection (the caret's line when nothing is selected)
 * or a problem with its lines, as a block that names its file and lines. A file shown as a node knows
 * its node, so a new chat gets a line from it; a tab names its path and the file becomes a node then.
 */
export class SelectionChatFeature {
    private readonly language: EditorLanguage;
    private nodeId: string | null = null;

    constructor(language: EditorLanguage) {
        this.language = language;
        const off = language.editor.onKeyDown((event) => {
            if (!isShortcut(CANVAS_SHORTCUTS.selectionToChat, event)) {
                return false;
            }
            this.choose();
            return true;
        });
        language.onDispose(off);
    }

    /* The node this editor is drawn in; null for a tab or a view of its own. */
    bindNode(nodeId: string | null): void {
        this.nodeId = nodeId;
    }

    /* Opens the chooser under the selection, or goes straight to the one chat linked to the file. */
    choose(): void {
        const { editor } = this.language;
        const range = this.range();
        const rect = editor.rectAt(range.end);
        const at = rect === null ? { x: window.innerWidth / 2, y: window.innerHeight / 3 } : { x: rect.left, y: rect.bottom };
        offerSelection({ ...this.offerFor(range), shortcut: CANVAS_SHORTCUTS.selectionToChat, returnFocus: () => editor.focus() }, at);
    }

    /* A new chat with this agent, linked to the file, with the selection in its prompt. */
    askAbout(provider: AgentKind): void {
        void startLinkedChatOrTell(this.offerFor(this.range()), provider);
    }

    /* A new chat with this agent about one problem: its lines and what the server said. */
    askAboutProblem(problem: Problem, provider: AgentKind): void {
        const { diagnostic } = problem;
        const offer = this.offerFor(diagnostic.range);
        const code = diagnostic.code === undefined ? '' : ` (${diagnostic.source === undefined ? '' : `${diagnostic.source} `}${diagnostic.code})`;
        const message = i18next.t('chat:selection.problem', { message: `${diagnostic.message}${code}` });
        void startLinkedChatOrTell({ ...offer, block: `${offer.block}\n\n${message}` }, provider);
    }

    /* The selection, or the whole line under the caret while nothing is selected. */
    private range(): EditorRange {
        const { editor } = this.language;
        const selection = editor.getSelection();
        if (selection.start.line !== selection.end.line || selection.start.character !== selection.end.character) {
            return selection;
        }
        const { line } = selection.start;
        return { start: { line, character: 0 }, end: { line, character: editor.getText().split('\n')[line]?.length ?? 0 } };
    }

    private offerFor(range: EditorRange): SelectionOffer {
        const { editor, uri, languageId } = this.language;
        const absolute = fileUriToPath(uri) ?? uri;
        const path = storedPathOf(useProject.getState().current?.folder ?? null, absolute);
        const text = editor.textInRange(range);
        // A selection that ends at the start of a line did not take that line.
        const endsOnBreak = range.end.character === 0 && range.end.line > range.start.line;
        const startLine = range.start.line + 1;
        const endLine = endsOnBreak ? range.end.line : range.end.line + 1;
        const language = PLAIN_IDS.has(languageId) ? null : shikiLanguageOf(languageId);
        return {
            block: selectionBlock(lineRangeLabel(path, startLine, endLine), text, language),
            label: lineRangeLabel(basenameOf(absolute), startLine, endLine),
            source: this.nodeId === null ? { path: absolute } : { nodeId: this.nodeId }
        };
    }
}
