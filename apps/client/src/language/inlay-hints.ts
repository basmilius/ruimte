import type { EditorInlayHint } from '@ruimte/smart-editor';
import type { InlayHint } from '@ruimte/smart-editor-lsp';
import type { EditorLanguage } from './editor-language';
import { Refresher } from './refresher';
import { realTimers, type Timers } from './timers';

const METHOD = 'textDocument/inlayHint';
const PAUSE_MS = 300;

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

/*
 * Types and parameter names the servers infer, drawn in the text as soft pills. They are asked for
 * the whole file after a pause in typing; until the answer comes the last ones stay where their text
 * went, so nothing blinks while typing.
 */
export class InlayHintsFeature {
    private readonly refresher: Refresher;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        const { editor, project, uri } = language;
        this.refresher = new Refresher(
            async (signal) => {
                const { service } = project;
                if (!service.supports(METHOD, uri)) {
                    return;
                }
                const range = { start: { line: 0, character: 0 }, end: editor.positionAt(Number.MAX_SAFE_INTEGER) };
                const hints = await service.inlayHints(uri, range, { signal });
                if (!signal.aborted) {
                    editor.setInlayHints(hints === null ? [] : editorHintsOf(hints));
                }
            },
            PAUSE_MS,
            timers
        );
        const edits = editor.onTextChange(() => this.refresher.later());
        const providers = project.service.onProvidersChanged((changed) => {
            if (changed === uri) {
                this.refresher.now();
            }
        });
        language.onDispose(() => {
            edits();
            providers.dispose();
            this.refresher.dispose();
            editor.setInlayHints([]);
        });
    }
}
