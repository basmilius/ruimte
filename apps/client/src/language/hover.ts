import type { EditorHover } from '@ruimte/smart-editor';
import type { EditorLanguage } from './editor-language';
import { rangeHolds } from './diagnostics-model';
import { createPopupStore } from './popups';
import { realTimers, type Timers } from './timers';

const SHOW_DELAY_MS = 300;
const HIDE_DELAY_MS = 250;

/*
 * The card under a character the pointer rests on: the problems there, and what the language servers
 * say about the symbol. It opens after the pointer has stayed a moment, stays while the pointer is on
 * the word or on the card itself, and goes when the text, the scroll or the focus moves.
 */
export class HoverFeature {
    readonly store = createPopupStore();
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private showTimer: unknown;
    private hideTimer: unknown;
    private inCard = false;
    /* Counts every request, so an answer that arrives after the pointer moved on is dropped. */
    private request = 0;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            editor.onHover((hover) => this.moved(hover)),
            editor.onTextChange(() => this.hide()),
            editor.onViewChange(() => this.hide()),
            editor.onKeyDown((event) => {
                if (event.key === 'Escape' && this.store.getState().hover !== null) {
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
        this.timers.clear(this.showTimer);
        this.timers.clear(this.hideTimer);
        this.inCard = false;
        if (this.store.getState().hover !== null) {
            this.store.setState({ hover: null });
        }
    }

    private moved(hover: EditorHover | null): void {
        this.timers.clear(this.showTimer);
        if (hover === null) {
            this.request++;
            this.scheduleHide();
            return;
        }
        const shown = this.store.getState().hover;
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
        if (this.store.getState().hover === null || this.inCard) {
            return;
        }
        this.hideTimer = this.timers.set(() => {
            if (!this.inCard) {
                this.hide();
            }
        }, HIDE_DELAY_MS);
    }

    private async show(hover: EditorHover, request: number): Promise<void> {
        const problems = this.language.diagnostics.at(hover.position);
        if (request !== this.request) {
            return;
        }
        if (problems.length === 0) {
            this.hide();
            return;
        }
        const first = problems[0]!.diagnostic.range;
        this.timers.clear(this.hideTimer);
        this.store.setState({
            hover: {
                anchor: first.start.line === hover.position.line ? first.start : hover.position,
                subject: first,
                problems
            }
        });
    }
}
