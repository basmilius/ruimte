import type { SignatureHelp, SignatureHelpContext } from '@ruimte/smart-editor-lsp';
import type { EditorPosition, EditorTextChange } from '@ruimte/smart-editor';
import type { EditorLanguage } from './editor-language';
import { signatureViewOf } from './signature-model';
import { realTimers, type Timers } from './timers';

const METHOD = 'textDocument/signatureHelp';
const PAUSE_MS = 60;

/*
 * The parameters of the call the caret is in, while its arguments are typed. It opens on a trigger
 * character of the server, such as `(` and `,`, and asks again as the caret moves or the text changes,
 * so the active parameter follows; the server answering nothing is the caret leaving the call.
 */
export class SignatureFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private timer: unknown;
    private request = 0;
    private controller: AbortController | null = null;
    private help: SignatureHelp | null = null;
    private anchor: EditorPosition | null = null;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            editor.onTextChange((change) => this.edited(change)),
            editor.onCaret(() => this.retrigger()),
            editor.onBlur(() => this.close()),
            editor.onKeyDown((event) => {
                if (event.key === 'Escape' && this.isOpen) {
                    this.close();
                    return true;
                }
                if (event.key === ' ' && event.ctrlKey && event.shiftKey && !event.metaKey && !event.altKey) {
                    this.invoke();
                    return true;
                }
                if ((event.key === 'ArrowUp' || event.key === 'ArrowDown') && !event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey) {
                    return this.cycle(event.key === 'ArrowDown' ? 1 : -1);
                }
                return false;
            })
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.close();
        });
    }

    get isOpen(): boolean {
        return this.language.popups.getState().signature !== null;
    }

    /* Asks for the parameters of the call at the caret, as Ctrl+Shift+Space does. */
    invoke(): void {
        this.ask({ triggerKind: 1, isRetrigger: false });
    }

    /* Shows the next overload, or the one before, while the card is up and has more than one; false when it has not, which leaves the arrow to the caret. */
    private cycle(step: 1 | -1): boolean {
        const { help } = this;
        if (help === null || help.signatures.length < 2 || !this.isOpen) {
            return false;
        }
        const count = help.signatures.length;
        const next = { ...help, activeSignature: (Math.min(Math.max(0, help.activeSignature ?? 0), count - 1) + step + count) % count };
        const model = signatureViewOf(next);
        if (model === null || this.anchor === null) {
            return false;
        }
        this.help = next;
        this.language.popups.setState({ signature: { anchor: this.anchor, model } });
        return true;
    }

    close(): void {
        this.request++;
        this.controller?.abort();
        this.timers.clear(this.timer);
        this.help = null;
        this.anchor = null;
        if (this.isOpen) {
            this.language.popups.setState({ signature: null });
        }
    }

    private options(): { triggers: readonly string[]; retriggers: readonly string[] } | null {
        const { project, uri } = this.language;
        const options = project.service.providerOptions(METHOD, uri);
        return options === undefined ? null : { triggers: options.triggerCharacters ?? [], retriggers: options.retriggerCharacters ?? [] };
    }

    private edited(change: EditorTextChange): void {
        const options = this.options();
        if (change.source !== 'input' || options === null) {
            this.close();
            return;
        }
        const text = change.changes.length === 1 ? change.changes[0]!.text : '';
        const last = Array.from(text).at(-1) ?? '';
        if (text.length === 1 && options.triggers.includes(last)) {
            this.ask({ triggerKind: 2, triggerCharacter: last, isRetrigger: this.isOpen });
        } else if (this.isOpen) {
            this.ask({
                triggerKind: text.length === 1 && options.retriggers.includes(last) ? 2 : 3,
                ...(options.retriggers.includes(last) ? { triggerCharacter: last } : {}),
                isRetrigger: true
            });
        }
    }

    private retrigger(): void {
        if (this.isOpen) {
            this.ask({ triggerKind: 3, isRetrigger: true });
        }
    }

    private ask(context: Omit<SignatureHelpContext, 'activeSignatureHelp'>): void {
        const { project, uri } = this.language;
        if (!project.service.supports(METHOD, uri)) {
            return;
        }
        this.timers.clear(this.timer);
        const request = ++this.request;
        const full: SignatureHelpContext = { ...context, ...(this.help === null ? {} : { activeSignatureHelp: this.help }) };
        this.timer = this.timers.set(() => void this.fetch(full, request), PAUSE_MS);
    }

    private async fetch(context: SignatureHelpContext, request: number): Promise<void> {
        const { editor, project, uri } = this.language;
        const caret = editor.getCaret();
        this.controller?.abort();
        const controller = new AbortController();
        this.controller = controller;
        let help: SignatureHelp | null;
        try {
            help = await project.service.signatureHelp(uri, caret, context, { signal: controller.signal });
        } catch {
            return;
        }
        if (request !== this.request) {
            return;
        }
        const model = signatureViewOf(help);
        if (model === null) {
            this.close();
            return;
        }
        this.help = help;
        this.anchor ??= caret;
        this.language.popups.setState({ signature: { anchor: this.anchor, model } });
    }
}
