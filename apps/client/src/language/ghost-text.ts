import type { EditorPosition } from '@adecore/editor';
import { shikiLanguageOf, type EditorLanguage, type InlineSuggestion, type InlineSuggestionRequest, type InlineSuggestionSource } from '@adecore/editor-react';
import { messageOf } from '@adecore/ui';
import { cleanGhost, ghostPrompt } from '@ruimte/contracts';
import i18next from 'i18next';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { type EditorAssistClient } from '@/editor-assist/client';
import { promptFileName } from '@/editor-assist/prompt-file';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import { GhostHint } from './GhostHint';

const TOAST_ID = 'language-ghost';
const PROGRESS_OWNER = 'ghost-progress';
/* The lines of the file the model reads on each side of the caret, before they are cut to what its window takes. */
const CONTEXT_LINES = 200;

function say(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`panels:language.ghost.${key}`, options);
}

function samePosition(one: EditorPosition, other: EditorPosition): boolean {
    return one.line === other.line && one.character === other.character;
}

/* Fills the element after a line with the hint, returning what takes it away again. */
export type GhostHintMount = (container: HTMLElement, phase: 'progress' | 'ready') => () => void;

function mountGhostHint(container: HTMLElement, phase: 'progress' | 'ready'): () => void {
    const root = createRoot(container);
    root.render(createElement(GhostHint, { phase }));

    // The editor may take the element away while React renders, which a synchronous unmount refuses.
    return () => queueMicrotask(() => root.unmount());
}

/*
 * Ghost text on request: Option+\ asks the model on the machine for a continuation at the caret. The editor's
 * inline completion draws it after the caret, where Tab takes all of it, Option+] a word of it and anything else
 * puts it away. It takes two to three seconds, so nothing is ever asked for while typing.
 */
export class GhostTextFeature implements InlineSuggestionSource {
    readonly automatic = false;
    private readonly language: EditorLanguage;
    private readonly client: EditorAssistClient;
    private readonly mountHint: GhostHintMount;
    private requesting: AbortSignal | null = null;

    constructor(language: EditorLanguage, client: EditorAssistClient, mountHint: GhostHintMount = mountGhostHint) {
        this.language = language;
        this.client = client;
        this.mountHint = mountHint;
        // Ahead of the language servers' suggestions, which a person's own key asks for only when this is off.
        language.onDispose(language.inlineCompletion.addSource(this, 100));
    }

    get active(): boolean {
        return this.language.inlineCompletion.holds(this);
    }

    get busy(): boolean {
        return this.requesting !== null;
    }

    get enabled(): boolean {
        return this.language.served && this.setting;
    }

    // Ghost text sends code to the editor model as Explain does, so it waits for the same opt-in.
    private get setting(): boolean {
        const { aiCodeHelp, aiGhostText } = useSettings.getState();

        return aiCodeHelp && aiGhostText === 'request';
    }

    /* Asks for a continuation at the caret and shows it when it comes, if the caret and the text are where they were. */
    async request(): Promise<void> {
        if (!this.setting) {
            this.tell(say('off'));
            return;
        }
        await this.language.inlineCompletion.triggerSource(this);
    }

    async suggest({ caret, signal }: InlineSuggestionRequest): Promise<readonly InlineSuggestion[]> {
        const { editor } = this.language;
        const selection = editor.getSelection();
        if (!samePosition(selection.start, selection.end)) {
            return [];
        }
        const status = await this.client.availability();
        if (!status.available) {
            this.tell(status.reason ?? say('unavailable'));
            return [];
        }
        const { before, after, restOfLine } = this.around(caret);
        const stop = (): void => {
            this.requesting = null;
            this.finishProgress();
        };
        signal.addEventListener('abort', stop, { once: true });
        this.requesting = signal;
        this.showProgress(caret);
        try {
            const result = await this.client.generate(
                {
                    purpose: 'ghost',
                    prompt: ghostPrompt({
                        language: shikiLanguageOf(this.language.languageId),
                        file: promptFileName(this.language.project.folder, this.language.uri),
                        before,
                        after
                    })
                },
                signal
            );
            if (signal.aborted || result.state !== 'done' || !samePosition(editor.getCaret(), caret)) {
                return [];
            }
            const cleaned = cleanGhost(result.text, before, after);
            // Text after the caret on the line stays where it is, so the suggestion is only the rest of this line.
            const text = restOfLine.trim() === '' ? cleaned : (cleaned.split('\n')[0] ?? '');
            if (text.trim() === '') {
                this.tell(say('none'));
                return [];
            }
            return [{ text, range: { start: caret, end: caret }, rest: text, words: true, accessory: (container) => this.mountHint(container, 'ready') }];
        } catch (error) {
            if (!signal.aborted) {
                this.tell(messageOf(error));
            }
            return [];
        } finally {
            signal.removeEventListener('abort', stop);
            if (this.requesting === signal) {
                stop();
            }
        }
    }

    private around(position: EditorPosition): { before: string; after: string; restOfLine: string } {
        const { editor } = this.language;
        const last = Number.MAX_SAFE_INTEGER;
        const before = editor.textInRange({ start: { line: Math.max(0, position.line - CONTEXT_LINES), character: 0 }, end: position });
        const after = editor.textInRange({ start: position, end: { line: position.line + CONTEXT_LINES, character: last } });
        return { before, after, restOfLine: after.split('\n')[0] ?? '' };
    }

    private showProgress(position: EditorPosition): void {
        this.language.editor.setLineActions(
            [{ id: 'progress', line: position.line, render: (container) => this.mountHint(container, 'progress') }],
            PROGRESS_OWNER
        );
    }

    private finishProgress(): void {
        this.language.editor.setLineActions([], PROGRESS_OWNER);
    }

    private tell(title: string): void {
        useToasts.getState().show({ id: TOAST_ID, kind: 'error', title });
    }
}
