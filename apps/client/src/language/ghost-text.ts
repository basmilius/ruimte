import i18next from 'i18next';
import { createElement } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { EditorPosition } from '@ruimte/smart-editor';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { cleanGhost, firstWord } from '@/ondevice/ghost-model';
import { onDeviceClientFor, type OnDeviceClient } from '@/ondevice/ondevice-client';
import { ghostPrompt } from '@/ondevice/prompts';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';
import type { EditorLanguage } from './editor-language';
import { GhostHint } from './GhostHint';
import { shikiLanguageOf } from './language-ids';
import { isShortcut } from './shortcut-keys';

const TOAST_ID = 'language-ghost';
const PROGRESS_OWNER = 'ghost-progress';
/* The lines of the file the model reads on each side of the caret, before they are cut to what its window takes. */
const CONTEXT_LINES = 200;

function say(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`panels:language.ghost.${key}`, options);
}

interface Suggestion {
    readonly position: EditorPosition;
    readonly text: string;
}

/*
 * Ghost text on request: Option+\ asks the model on the machine for a continuation at the caret and draws
 * it after the caret, where Tab takes all of it, Option+] a word of it and anything else puts it away. It
 * takes two to three seconds, so nothing is ever asked for while typing.
 */
export class GhostTextFeature {
    private readonly language: EditorLanguage;
    private readonly client: OnDeviceClient;
    private suggestion: Suggestion | null = null;
    private controller: AbortController | null = null;
    /* Counts the edits of the text, so an answer for text that has changed since is dropped. */
    private revision = 0;
    private accepting = false;
    private hints: Root[] = [];

    constructor(language: EditorLanguage, client: OnDeviceClient = onDeviceClientFor(language.project.transport)) {
        this.language = language;
        this.client = client;
        const { editor } = language;
        const offs = [
            editor.onKeyDown((event) => this.key(event)),
            editor.onTextChange(() => {
                if (!this.accepting) {
                    this.revision++;
                    this.dismiss();
                }
            }),
            editor.onCaret((position) => {
                const shown = this.suggestion?.position;
                if (shown !== undefined && (shown.line !== position.line || shown.character !== position.character) && !this.accepting) {
                    this.dismiss();
                }
            })
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.dismiss();
        });
    }

    get active(): boolean {
        return this.suggestion !== null;
    }

    get busy(): boolean {
        return this.controller !== null;
    }

    private get enabled(): boolean {
        return useSettings.getState().aiGhostText === 'request';
    }

    private key(event: KeyboardEvent): boolean {
        if (isShortcut(CANVAS_SHORTCUTS.suggestInline, event)) {
            if (!this.enabled) {
                return false;
            }
            void this.request();
            return true;
        }
        if (event.key === 'Escape' && (this.suggestion !== null || this.controller !== null)) {
            this.dismiss();
            return true;
        }
        if (this.suggestion === null) {
            return false;
        }
        if (event.key === 'Tab' && !event.shiftKey && !event.ctrlKey && !event.altKey && !event.metaKey) {
            this.accept();
            return true;
        }
        if (isShortcut(CANVAS_SHORTCUTS.acceptGhostWord, event)) {
            this.acceptWord();
            return true;
        }
        return false;
    }

    /* Asks for a continuation at the caret and shows it when it comes, if the caret and the text are where they were. */
    async request(): Promise<void> {
        if (!this.enabled) {
            this.tell(say('off'));
            return;
        }
        const { editor } = this.language;
        const selection = editor.getSelection();
        if (selection.start.line !== selection.end.line || selection.start.character !== selection.end.character) {
            return;
        }
        this.dismiss();
        const status = await this.client.availability();
        if (!status.available) {
            this.tell(status.reason ?? say('unavailable'));
            return;
        }
        const controller = new AbortController();
        this.controller = controller;
        const position = editor.getCaret();
        const revision = this.revision;
        const { before, after, restOfLine } = this.around(position);
        this.showProgress(position);
        try {
            const result = await this.client.generate(
                {
                    purpose: 'ghost',
                    prompt: ghostPrompt({ language: shikiLanguageOf(this.language.languageId), file: this.fileName(), before, after })
                },
                controller.signal
            );
            if (this.controller !== controller) {
                return;
            }
            this.finishProgress();
            this.controller = null;
            const caret = editor.getCaret();
            if (result.state !== 'done' || revision !== this.revision || caret.line !== position.line || caret.character !== position.character) {
                return;
            }
            const cleaned = cleanGhost(result.text, before, after);
            // Text after the caret on the line stays where it is, so the suggestion is only the rest of this line.
            const text = restOfLine.trim() === '' ? cleaned : (cleaned.split('\n')[0] ?? '');
            if (text.trim() === '') {
                this.tell(say('none'));
                return;
            }
            this.show({ position, text });
        } catch (error) {
            if (this.controller === controller) {
                this.finishProgress();
                this.controller = null;
                this.tell(error instanceof Error ? error.message : String(error));
            }
        }
    }

    /* Takes all of the suggestion into the text, as one step of the undo history. */
    accept(): void {
        const suggestion = this.suggestion;
        if (suggestion !== null) {
            this.insert(suggestion, suggestion.text);
        }
    }

    /* Takes the first word of the suggestion, and the rest stays as the suggestion after it. */
    acceptWord(): void {
        const suggestion = this.suggestion;
        if (suggestion !== null) {
            this.insert(suggestion, firstWord(suggestion.text));
        }
    }

    /* Puts the suggestion away, and ends a request that is still out. */
    dismiss(): void {
        this.controller?.abort();
        this.controller = null;
        this.finishProgress();
        if (this.suggestion !== null) {
            this.suggestion = null;
            this.language.editor.setGhostText(null);
            this.unmountHints();
        }
    }

    private insert(suggestion: Suggestion, inserted: string): void {
        const { editor } = this.language;
        const rest = suggestion.text.slice(inserted.length);
        this.accepting = true;
        try {
            editor.applyEdits([{ range: { start: suggestion.position, end: suggestion.position }, text: inserted }]);
        } finally {
            this.accepting = false;
        }
        this.suggestion = null;
        this.unmountHints();
        const lines = inserted.split('\n');
        const next: EditorPosition =
            lines.length === 1
                ? { line: suggestion.position.line, character: suggestion.position.character + inserted.length }
                : { line: suggestion.position.line + lines.length - 1, character: lines.at(-1)!.length };
        editor.setCaret(next);
        if (rest.trim() !== '') {
            this.show({ position: next, text: rest });
        }
    }

    private show(suggestion: Suggestion): void {
        this.suggestion = suggestion;
        this.language.editor.setGhostText({
            position: suggestion.position,
            text: suggestion.text,
            accessory: (container) => this.mountHint(container, 'ready')
        });
    }

    /* The text a model reads on each side of the caret, and what is left of the caret's line after it. */
    private around(position: EditorPosition): { before: string; after: string; restOfLine: string } {
        const { editor } = this.language;
        const last = Number.MAX_SAFE_INTEGER;
        const before = editor.textInRange({ start: { line: Math.max(0, position.line - CONTEXT_LINES), character: 0 }, end: position });
        const after = editor.textInRange({ start: position, end: { line: position.line + CONTEXT_LINES, character: last } });
        return { before, after, restOfLine: after.split('\n')[0] ?? '' };
    }

    private fileName(): string {
        const path = decodeURIComponent(this.language.uri.replace(/^file:\/\//, ''));
        const folder = this.language.project.folder;
        return path.startsWith(`${folder}/`) ? path.slice(folder.length + 1) : path;
    }

    private showProgress(position: EditorPosition): void {
        this.language.editor.setLineActions(
            [{ id: 'progress', line: position.line, render: (container) => this.mountHint(container, 'progress') }],
            PROGRESS_OWNER
        );
    }

    private finishProgress(): void {
        this.language.editor.setLineActions([], PROGRESS_OWNER);
        this.unmountHints();
    }

    private mountHint(container: HTMLElement, phase: 'progress' | 'ready'): void {
        const root = createRoot(container);
        root.render(createElement(GhostHint, { phase }));
        this.hints.push(root);
    }

    private unmountHints(): void {
        for (const root of this.hints.splice(0)) {
            queueMicrotask(() => root.unmount());
        }
    }

    private tell(title: string): void {
        useToasts.getState().show({ id: TOAST_ID, kind: 'error', title });
    }
}
