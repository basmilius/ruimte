import i18next from 'i18next';
import type { EditorHover, EditorPosition, EditorRange } from '@ruimte/smart-editor';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { useToasts } from '@/state/toasts';
import type { EditorLanguage } from './editor-language';
import { rangeHolds, type Problem } from './diagnostics-model';
import { hoverTextOf, isEmptyHover, locationsOf } from './hover-content';
import { wordRangeAt } from './rename-model';
import type { HoverInfo } from './popups';
import { isShortcut } from './shortcut-keys';
import { realTimers, type Timers } from './timers';

const SHOW_DELAY_MS = 300;
const HIDE_DELAY_MS = 250;
/* How long a card has to stay up before the references of its symbol are counted, which can be a request over the whole project. */
const COUNT_DELAY_MS = 500;
const TOAST_ID = 'language-hover';

/*
 * The card under a character the pointer rests on: the problems there, and what the language servers
 * say about the symbol. It opens after the pointer has stayed a moment, stays while the pointer is on
 * the word or on the card itself, and goes when the text, the scroll or the focus moves.
 */
export class HoverFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private showTimer: unknown;
    private countTimer: unknown;
    /* The counts asked for since the text last changed, by the symbol's position, so moving back to a name does not ask again. */
    private readonly counts = new Map<string, number>();
    private hideTimer: unknown;
    private inCard = false;
    /* Counts every request, so an answer that arrives after the pointer moved on is dropped. */
    private request = 0;
    private lookup: AbortController | null = null;
    /* A card the keyboard opened: scrolling does not take it away, since it was never under a pointer. Moving the caret does. */
    private pinned = false;
    /* The card is being read: an explanation runs in it or is shown, so the pointer going elsewhere neither closes nor replaces it. */
    private held = false;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            editor.onHover((hover) => this.moved(hover)),
            editor.onTextChange(() => {
                this.counts.clear();
                this.hide();
            }),
            editor.onClick(() => {
                if (this.held) {
                    this.hide();
                }
                return false;
            }),
            editor.onViewChange(() => {
                if (!this.pinned) {
                    this.hide();
                }
            }),
            editor.onCaret(() => {
                if (this.pinned) {
                    this.hide();
                }
            }),
            editor.onKeyDown((event) => {
                if (isShortcut(CANVAS_SHORTCUTS.quickInfo, event)) {
                    this.quickInfo();
                    return true;
                }
                if (event.key === 'Escape' && this.language.popups.getState().hover !== null) {
                    this.hide();
                    return true;
                }
                return false;
            })
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.hide();
        });
    }

    /* The pointer entered or left the card, which is where a link in it is clicked. */
    holdCard(inside: boolean): void {
        this.inCard = inside;
        if (inside) {
            this.timers.clear(this.hideTimer);
        } else {
            this.scheduleHide();
        }
    }

    /* The card for the caret, as a pointer resting there would open it. */
    quickInfo(): void {
        const request = ++this.request;
        this.timers.clear(this.showTimer);
        void this.show(this.language.editor.getCaret(), request, true);
    }

    /* The problems at a position as a card, at once; what the servers say about the symbol is left for the pointer and Quick Info. */
    showProblemsAt(position: EditorPosition): boolean {
        const problems = this.language.diagnostics.at(position);
        if (problems.length === 0) {
            return false;
        }
        this.hide();
        this.pinned = true;
        this.present(position, problems, null, problems[0]!.diagnostic.range);
        return true;
    }

    /* Keeps the card up until Escape, a press in the text, an edit or a move of the caret. */
    keep(): void {
        this.pinned = true;
        this.held = true;
        this.timers.clear(this.hideTimer);
    }

    /* A card of its own for a range, such as the explanation of a selection, which stays like the card Quick Info opens. */
    showRange(range: EditorRange): void {
        this.hide();
        this.keep();
        this.present(range.start, [], null, range);
    }

    hide(): void {
        this.pinned = false;
        this.held = false;
        this.request++;
        this.lookup?.abort();
        this.timers.clear(this.showTimer);
        this.timers.clear(this.hideTimer);
        this.timers.clear(this.countTimer);
        this.inCard = false;
        if (this.language.popups.getState().hover !== null) {
            this.language.popups.setState({ hover: null });
        }
    }

    private moved(hover: EditorHover | null): void {
        if (this.held) {
            return;
        }
        this.timers.clear(this.showTimer);
        if (hover === null) {
            this.request++;
            this.scheduleHide();
            return;
        }
        const shown = this.language.popups.getState().hover;
        if (shown !== null && rangeHolds(shown.subject, hover.position)) {
            this.timers.clear(this.hideTimer);
            return;
        }
        this.scheduleHide();
        const request = ++this.request;
        this.showTimer = this.timers.set(() => void this.show(hover.position, request, false), SHOW_DELAY_MS);
    }

    private scheduleHide(): void {
        this.timers.clear(this.hideTimer);
        if (this.language.popups.getState().hover === null || this.inCard || this.held) {
            return;
        }
        this.hideTimer = this.timers.set(() => {
            if (!this.inCard) {
                this.hide();
            }
        }, HIDE_DELAY_MS);
    }

    /* What the servers say at a position: the hover text and the definition, each of which may be missing without the other. */
    private async ask(position: EditorHover['position'], signal: AbortSignal): Promise<{ info: HoverInfo | null; range: EditorRange | null }> {
        const { service } = this.language.project;
        const { uri } = this.language;
        if (!service.supports('textDocument/hover', uri)) {
            return { info: null, range: null };
        }
        const [hover, definition] = await Promise.all([
            service.hover(uri, position, { signal }).catch(() => null),
            service.supports('textDocument/definition', uri) ? service.definition(uri, position, { signal }).catch(() => null) : null
        ]);
        const text = hover === null ? null : hoverTextOf(hover);
        if (hover === null || text === null || isEmptyHover(text)) {
            return { info: null, range: null };
        }
        const { editor } = this.language;
        const line = editor.textInRange({ start: { line: position.line, character: 0 }, end: { line: position.line, character: Number.MAX_SAFE_INTEGER } });
        const word = wordRangeAt(line, position);
        return {
            info: {
                text,
                definition: locationsOf(definition)[0] ?? null,
                word: word === null ? '' : line.slice(word.start.character, word.end.character),
                references: null
            },
            range: hover.range ?? null
        };
    }

    private async show(position: EditorPosition, request: number, pinned: boolean): Promise<void> {
        const problems = this.language.diagnostics.at(position);
        this.lookup?.abort();
        const controller = new AbortController();
        this.lookup = controller;
        const { info, range } = await this.ask(position, controller.signal);
        if (request !== this.request) {
            return;
        }
        if (problems.length === 0 && info === null) {
            this.hide();
            if (pinned) {
                useToasts.getState().show({ id: TOAST_ID, kind: 'error', title: i18next.t('panels:language.hover.none') });
            }
            return;
        }
        this.pinned = pinned;
        this.present(position, problems, info, problems[0]?.diagnostic.range ?? range);
        if (info !== null) {
            this.scheduleCount(position, request, controller.signal);
        }
    }

    private present(position: EditorPosition, problems: readonly Problem[], info: HoverInfo | null, range: EditorRange | null): void {
        const subject = range ?? { start: position, end: position };
        this.timers.clear(this.hideTimer);
        this.language.popups.setState({
            hover: {
                anchor: subject.start.line === position.line ? subject.start : position,
                position,
                subject,
                problems,
                info
            }
        });
    }

    /* The references of the symbol are counted once the card has stayed up a while, or at once when the text has not changed since they were. */
    private scheduleCount(position: EditorPosition, request: number, signal: AbortSignal): void {
        const key = `${position.line}:${this.wordStart(position)}`;
        const known = this.counts.get(key);
        if (known !== undefined) {
            this.showCount(known, request);
            return;
        }
        this.timers.clear(this.countTimer);
        this.countTimer = this.timers.set(() => void this.count(position, key, request, signal), COUNT_DELAY_MS);
    }

    /* How many places use the symbol, which can take a while in a large project and so arrives after the card does. */
    private async count(position: EditorPosition, key: string, request: number, signal: AbortSignal): Promise<void> {
        const { service } = this.language.project;
        if (request !== this.request || !service.supports('textDocument/references', this.language.uri)) {
            return;
        }
        const found = await service.references(this.language.uri, position, false, { signal }).catch(() => null);
        if (found === null) {
            return;
        }
        this.counts.set(key, found.length);
        this.showCount(found.length, request);
    }

    private showCount(count: number, request: number): void {
        const shown = this.language.popups.getState().hover;
        if (request === this.request && shown?.info != null) {
            this.language.popups.setState({ hover: { ...shown, info: { ...shown.info, references: count } } });
        }
    }

    /* Where the word at a position starts, which names the symbol for the cache. */
    wordStart(position: EditorPosition): number {
        const line = this.language.editor.textInRange({
            start: { line: position.line, character: 0 },
            end: { line: position.line, character: Number.MAX_SAFE_INTEGER }
        });
        return wordRangeAt(line, position)?.start.character ?? position.character;
    }
}
