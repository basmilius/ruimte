import type { EditorRange } from '@adecore/editor';
import { shikiLanguageOf, type EditorLanguage, type HoverView } from '@adecore/editor-react';
import { isEmptyRange } from '@adecore/editor-react/models';
import { messageOf } from '@adecore/ui';
import i18next from 'i18next';
import { createStore, type StoreApi } from 'zustand';
import { type EditorAssistClient } from '@/editor-assist/client';
import { functionSourceAt, isFunctionSignature } from '@/editor-assist/explain-model';
import { promptFileName } from '@/editor-assist/prompt-file';
import { explainPrompt } from '@/editor-assist/prompts';
import { useSettings } from '@/state/settings';
import { useToasts } from '@/state/toasts';

const TOAST_ID = 'language-explain';

/* What the card of a symbol or selection says about its explanation. */
interface ExplainView {
    /* The card offers an Explain link: the setting is on, the symbol is a function and the machine has the model. */
    readonly offered: boolean;
    readonly phase: 'idle' | 'running' | 'done' | 'error';
    readonly text: string;
    readonly error: string | null;
}

const IDLE: ExplainView = { offered: false, phase: 'idle', text: '', error: null };

const ANSWER_LANGUAGES: Readonly<Record<string, string>> = { en: 'English', nl: 'Dutch' };

/* The name of the interface language as the model is asked in it, since it follows a language named in words and not a code. */
function answerLanguage(code: string): string {
    return ANSWER_LANGUAGES[code.split('-')[0]!] ?? 'English';
}

function say(key: string, options?: Record<string, unknown>): string {
    return i18next.t(`panels:language.editorAssist.${key}`, options);
}

/*
 * Explain: a summary of a function or a selection from the model on the machine, shown in the hover card as
 * it streams. The explanation belongs to the card it was asked in and is cancelled when that card goes.
 */
export class ExplainFeature {
    readonly store: StoreApi<ExplainView> = createStore<ExplainView>(() => IDLE);
    private readonly language: EditorLanguage;
    private readonly client: EditorAssistClient;
    private controller: AbortController | null = null;
    private subject: HoverView['subject'] | null = null;

    constructor(language: EditorLanguage, client: EditorAssistClient) {
        this.language = language;
        this.client = client;
        const card = language.popups.slot('hover');
        let previous = card.get();
        const unsubscribe = card.subscribe(() => {
            const hover = card.get();
            const changed = hover?.subject !== previous?.subject;
            previous = hover;
            if (changed) {
                this.reset();
                if (hover !== null) {
                    this.offer(hover);
                }
            }
        });
        language.onDispose(() => {
            unsubscribe();
            this.reset();
        });
    }

    private get enabled(): boolean {
        return this.language.served && useSettings.getState().aiCodeHelp;
    }

    private reset(): void {
        this.controller?.abort();
        this.controller = null;
        this.subject = null;
        if (this.store.getState() !== IDLE) {
            this.store.setState(IDLE, true);
        }
    }

    /* Offers Explain on a card of a function once the machine has said it has the model. */
    private offer(hover: HoverView): void {
        const signature = hover.info?.text.signatures[0]?.code;
        if (!this.enabled || signature === undefined || !isFunctionSignature(signature)) {
            return;
        }
        this.subject = hover.subject;
        void this.client.availability().then((status) => {
            if (status.available && this.subject === hover.subject && this.store.getState().phase === 'idle') {
                this.store.setState({ ...IDLE, offered: true }, true);
            }
        });
    }

    /* Explains the symbol of the card that is up: its source, found from its definition, with its signature and documentation. */
    async explainCard(): Promise<void> {
        const hover = this.language.popups.slot('hover').get();
        const info = hover?.info;
        if (hover == null || info == null) {
            return;
        }
        const signature = info.text.signatures[0]?.code;
        const definition = info.definition;
        const text = definition === null ? null : await this.language.project.readText(definition.uri);
        const source = text === null || definition === null ? '' : functionSourceAt(text, definition.range.start.line);
        const place = definition === null ? this.language.uri : definition.uri;
        await this.run(hover.subject, {
            language: shikiLanguageOf(this.language.languageId),
            file: this.fileOf(place),
            ...(signature === undefined ? {} : { signature }),
            documentation: info.text.markdown,
            source: source === '' ? (signature ?? info.word) : source
        });
    }

    /* The selection, or without one the function around the caret, as a card of its own. */
    async explainHere(): Promise<void> {
        if (!this.enabled) {
            this.tell('off');
            return;
        }
        const { editor } = this.language;
        const selection = editor.getSelection();
        const range = isEmptyRange(selection) ? await this.functionAround(selection.start.line) : selection;
        if (range === null) {
            this.tell('nothing');
            return;
        }
        const source = editor.textInRange(range);
        if (source.trim() === '') {
            this.tell('nothing');
            return;
        }
        this.language.hover.showRange(range);
        const subject = this.language.popups.slot('hover').get()?.subject;
        if (subject !== undefined) {
            await this.run(subject, { language: shikiLanguageOf(this.language.languageId), file: this.fileOf(this.language.uri), source });
        }
    }

    private async functionAround(line: number): Promise<EditorRange | null> {
        const { service } = this.language.project;
        if (!service.supports('textDocument/documentSymbol', this.language.uri)) {
            return null;
        }
        const symbols = await service.documentSymbols(this.language.uri).catch(() => null);
        return innermostFunction(symbols, line);
    }

    private fileOf(uri: string): string {
        return promptFileName(this.language.project.folder, uri);
    }

    private async run(subject: HoverView['subject'], input: Parameters<typeof explainPrompt>[0]): Promise<void> {
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        this.subject = subject;
        this.language.hover.keep();
        const current = (): boolean => this.controller === controller;
        this.store.setState({ offered: false, phase: 'running', text: '', error: null }, true);
        try {
            const result = await this.client.generate(
                {
                    purpose: 'explain',
                    prompt: explainPrompt(input, answerLanguage(i18next.language)),
                    onText: (text) => current() && this.store.setState({ text: text.trim() })
                },
                controller.signal
            );
            if (current() && result.state === 'done') {
                this.store.setState({ phase: 'done', text: result.text.trim() });
            }
        } catch (error) {
            if (current()) {
                this.store.setState({ phase: 'error', error: messageOf(error) });
            }
        }
    }

    private tell(key: string): void {
        useToasts.getState().show({ id: TOAST_ID, kind: 'error', title: say(key) });
    }
}

interface SymbolLike {
    readonly kind?: number;
    readonly range?: EditorRange;
    readonly location?: { readonly range: EditorRange };
    readonly children?: readonly SymbolLike[];
}

/* LSP `SymbolKind`: Method, Constructor and Function. */
const FUNCTION_KINDS = new Set([6, 9, 12]);

/* The innermost method, constructor or function whose lines hold a line. */
export function innermostFunction(symbols: readonly SymbolLike[] | null, line: number): EditorRange | null {
    let found: EditorRange | null = null;
    const walk = (list: readonly SymbolLike[]): void => {
        for (const symbol of list) {
            const range = symbol.range ?? symbol.location?.range;
            if (range !== undefined && range.start.line <= line && line <= range.end.line) {
                if (symbol.kind !== undefined && FUNCTION_KINDS.has(symbol.kind)) {
                    found = range;
                }
                walk(symbol.children ?? []);
            }
        }
    };
    walk(symbols ?? []);
    return found;
}
