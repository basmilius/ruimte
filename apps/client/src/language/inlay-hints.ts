import type { EditorInlayHint, EditorPosition, EditorRange } from '@ruimte/smart-editor';
import type { InlayHint } from '@ruimte/smart-editor-lsp';
import type { EditorLanguage } from './editor-language';
import { Refresher } from './refresher';
import { realTimers, type Timers } from './timers';

const METHOD = 'textDocument/inlayHint';
const PAUSE_MS = 300;
/* Lines asked for above and below what is in view, so a little scrolling stays inside what is already drawn. */
const MARGIN_LINES = 60;

/* A hint's label is a string or a list of parts, which are read as one text. */
export function hintLabelOf(hint: InlayHint): string {
    return typeof hint.label === 'string' ? hint.label : hint.label.map((part) => part.value).join('');
}

export function editorHintsOf(hints: readonly InlayHint[]): EditorInlayHint[] {
    return hints
        .map((hint) => ({ position: hint.position, label: hintLabelOf(hint) }))
        .filter((hint) => hint.label !== '')
        .sort((left, right) => left.position.line - right.position.line || left.position.character - right.position.character);
}

/* The lines in view with a margin of lines around them, from the start of the first to the end of the last. */
export function withMargin(visible: EditorRange, endOfDocument: EditorPosition, endOfLine: (line: number) => EditorPosition): EditorRange {
    const first = Math.max(0, visible.start.line - MARGIN_LINES);
    const last = Math.min(endOfDocument.line, visible.end.line + MARGIN_LINES);
    return { start: { line: first, character: 0 }, end: last === endOfDocument.line ? endOfDocument : endOfLine(last) };
}

/* Whether what was asked for already holds every line in view. */
export function covers(asked: EditorRange, visible: EditorRange): boolean {
    return asked.start.line <= visible.start.line && asked.end.line >= visible.end.line;
}

/*
 * Types and parameter names the servers infer, drawn in the text as soft pills. They are asked for the
 * lines in view and a margin around them after a pause in typing or scrolling; until the answer comes the
 * last ones stay where their text went, so nothing blinks while typing. Scrolling asks again only once the
 * view leaves the lines that were asked for.
 */
export class InlayHintsFeature {
    private readonly refresher: Refresher;
    /* The lines the hints on screen were asked for. */
    private asked: EditorRange | null = null;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        const { editor, project, uri } = language;
        this.refresher = new Refresher(
            async (signal) => {
                const { service } = project;
                if (!service.supports(METHOD, uri)) {
                    return;
                }
                const range = withMargin(editor.getVisibleRange(), editor.positionAt(Number.MAX_SAFE_INTEGER), (line) => ({
                    line,
                    character: editor.textInRange({ start: { line, character: 0 }, end: { line, character: Number.MAX_SAFE_INTEGER } }).length
                }));
                this.asked = range;
                const hints = await service.inlayHints(uri, range, { signal });
                if (!signal.aborted) {
                    editor.setInlayHints(hints === null ? [] : editorHintsOf(hints));
                }
            },
            PAUSE_MS,
            timers
        );
        const edits = editor.onTextChange(() => this.refresher.later());
        const scrolls = editor.onViewChange(() => {
            if (this.asked !== null && !covers(this.asked, editor.getVisibleRange())) {
                this.refresher.later();
            }
        });
        const providers = project.service.onProvidersChanged((changed) => {
            if (changed === uri) {
                this.refresher.now();
            }
        });
        language.onDispose(() => {
            edits();
            scrolls();
            providers.dispose();
            this.refresher.dispose();
            editor.setInlayHints([]);
        });
    }
}
