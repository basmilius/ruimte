import type { EditorHover, EditorRange } from '@ruimte/smart-editor';
import type { EditorLanguage } from './editor-language';
import { rangeHolds } from './diagnostics-model';
import { hoverTextOf, isEmptyHover, locationsOf } from './hover-content';
import { wordRangeAt } from './rename-model';
import type { HoverInfo } from './popups';
import { realTimers, type Timers } from './timers';

const SHOW_DELAY_MS = 300;
const HIDE_DELAY_MS = 250;

/*
 * The card under a character the pointer rests on: the problems there, and what the language servers
 * say about the symbol. It opens after the pointer has stayed a moment, stays while the pointer is on
 * the word or on the card itself, and goes when the text, the scroll or the focus moves.
 */
export class HoverFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private showTimer: unknown;
    private hideTimer: unknown;
    private inCard = false;
    /* Counts every request, so an answer that arrives after the pointer moved on is dropped. */
    private request = 0;
    private lookup: AbortController | null = null;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            editor.onHover((hover) => this.moved(hover)),
            editor.onTextChange(() => this.hide()),
            editor.onViewChange(() => this.hide()),
            editor.onKeyDown((event) => {
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

    hide(): void {
        this.request++;
        this.lookup?.abort();
        this.timers.clear(this.showTimer);
        this.timers.clear(this.hideTimer);
        this.inCard = false;
        if (this.language.popups.getState().hover !== null) {
            this.language.popups.setState({ hover: null });
        }
    }

    private moved(hover: EditorHover | null): void {
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
        this.showTimer = this.timers.set(() => void this.show(hover, request), SHOW_DELAY_MS);
    }

    private scheduleHide(): void {
        this.timers.clear(this.hideTimer);
        if (this.language.popups.getState().hover === null || this.inCard) {
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

    private async show(hover: EditorHover, request: number): Promise<void> {
        const problems = this.language.diagnostics.at(hover.position);
        this.lookup?.abort();
        const controller = new AbortController();
        this.lookup = controller;
        const { info, range } = await this.ask(hover.position, controller.signal);
        if (request !== this.request) {
            return;
        }
        if (problems.length === 0 && info === null) {
            this.hide();
            return;
        }
        const subject = problems[0]?.diagnostic.range ?? range ?? { start: hover.position, end: hover.position };
        this.timers.clear(this.hideTimer);
        this.language.popups.setState({
            hover: {
                anchor: subject.start.line === hover.position.line ? subject.start : hover.position,
                position: hover.position,
                subject,
                problems,
                info
            }
        });
        if (info !== null) {
            void this.count(hover.position, request, controller.signal);
        }
    }

    /* How many places use the symbol, which can take a while in a large project and so arrives after the card does. */
    private async count(position: EditorHover['position'], request: number, signal: AbortSignal): Promise<void> {
        const { service } = this.language.project;
        if (!service.supports('textDocument/references', this.language.uri)) {
            return;
        }
        const found = await service.references(this.language.uri, position, false, { signal }).catch(() => null);
        const shown = this.language.popups.getState().hover;
        if (found === null || request !== this.request || shown?.info == null) {
            return;
        }
        this.language.popups.setState({ hover: { ...shown, info: { ...shown.info, references: found.length } } });
    }
}
