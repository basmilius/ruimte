import type { EditorPosition } from '@adecore/editor';
import type { EditorLanguage } from './editor-language';
import type { PickGroup, PickPreview } from './popups';
import { realTimers, type Timers } from './timers';

const PREVIEW_DELAY_MS = 120;

export interface PickSpec {
    readonly anchor: EditorPosition;
    readonly title?: string;
    readonly groups: readonly PickGroup[];
    /* The row the list opens on; the first one without it. */
    readonly active?: string;
    accept(id: string): void;
    /*
     * Asked before the list closes on a row. A reason it cannot be taken keeps the list open with the reason
     * under it, the way a rename keeps its input; null lets the list close and `accept` run.
     */
    attempt?(id: string): Promise<string | null>;
    /* What the active row would change, asked a moment after it became active. */
    preview?(id: string, signal: AbortSignal): Promise<PickPreview | null>;
}

/*
 * The one list an editor has open under a character, for code actions, the places a name is defined and
 * the like. The editor keeps the focus: arrows move through the rows, Enter takes the active one and
 * Escape, typing, a click elsewhere or a change of the text close it.
 */
export class PickFeature {
    private readonly language: EditorLanguage;
    private readonly timers: Timers;
    private spec: PickSpec | null = null;
    private ids: readonly string[] = [];
    private active = '';
    private previewTimer: unknown;
    private controller: AbortController | null = null;
    /* The rows that said why they cannot be taken, by id. */
    private refusals = new Map<string, string>();
    private attempting = false;

    constructor(language: EditorLanguage, timers: Timers = realTimers) {
        this.language = language;
        this.timers = timers;
        const { editor } = language;
        const offs = [
            editor.onKeyDown((event) => this.key(event)),
            editor.onTextChange(() => this.close()),
            editor.onCaret(() => this.close()),
            editor.onBlur(() => this.close())
        ];
        language.onDispose(() => {
            for (const off of offs) {
                off();
            }
            this.close();
        });
    }

    get isOpen(): boolean {
        return this.spec !== null;
    }

    open(spec: PickSpec): void {
        this.close();
        const ids = spec.groups.flatMap((group) => group.rows.map((row) => row.id));
        if (ids.length === 0) {
            return;
        }
        this.spec = spec;
        this.refusals = new Map();
        this.ids = ids;
        this.active = spec.active !== undefined && ids.includes(spec.active) ? spec.active : ids[0]!;
        this.publish(null);
        this.schedulePreview();
    }

    close(): void {
        if (this.spec === null) {
            return;
        }
        this.spec = null;
        this.timers.clear(this.previewTimer);
        this.controller?.abort();
        this.controller = null;
        this.language.popups.setState({ pick: null });
    }

    move(delta: number): void {
        const index = this.ids.indexOf(this.active);
        this.activate(this.ids[Math.max(0, Math.min(this.ids.length - 1, index + delta))]!);
    }

    /* Takes a row, by a click or Enter. */
    choose(id: string): void {
        const spec = this.spec;
        if (spec === null || !this.ids.includes(id) || this.attempting) {
            return;
        }
        if (spec.attempt === undefined) {
            this.close();
            spec.accept(id);
            return;
        }
        this.attempting = true;
        void spec
            .attempt(id)
            .catch(() => null)
            .then((reason) => {
                this.attempting = false;
                if (this.spec !== spec) {
                    return;
                }
                if (reason === null) {
                    this.close();
                    spec.accept(id);
                    return;
                }
                this.refusals.set(id, reason);
                this.publish(null);
            });
    }

    private activate(id: string): void {
        if (id === this.active) {
            return;
        }
        this.active = id;
        this.controller?.abort();
        this.publish(null);
        this.schedulePreview();
    }

    private key(event: KeyboardEvent): boolean {
        if (this.spec === null || event.metaKey || event.ctrlKey || event.altKey) {
            return false;
        }
        switch (event.key) {
            case 'ArrowDown':
                this.move(1);
                return true;
            case 'ArrowUp':
                this.move(-1);
                return true;
            case 'PageDown':
                this.move(8);
                return true;
            case 'PageUp':
                this.move(-8);
                return true;
            case 'Home':
                this.activate(this.ids[0]!);
                return true;
            case 'End':
                this.activate(this.ids[this.ids.length - 1]!);
                return true;
            case 'Enter':
            case 'Tab':
                this.choose(this.active);
                return true;
            case 'Escape':
                this.close();
                return true;
            default:
                return false;
        }
    }

    private schedulePreview(): void {
        const spec = this.spec;
        this.timers.clear(this.previewTimer);
        if (spec?.preview === undefined) {
            return;
        }
        const id = this.active;
        this.previewTimer = this.timers.set(() => {
            const controller = new AbortController();
            this.controller = controller;
            spec.preview!(id, controller.signal)
                .then((preview) => {
                    if (this.spec === spec && this.active === id && !controller.signal.aborted) {
                        this.publish(preview);
                    }
                })
                .catch(() => undefined);
        }, PREVIEW_DELAY_MS);
    }

    private publish(preview: PickPreview | null): void {
        const spec = this.spec;
        if (spec === null) {
            return;
        }
        const refusal = this.refusals.get(this.active);
        const shown = refusal === undefined ? preview : { removed: [], added: [], note: null, refusal };
        this.language.popups.setState({ pick: { anchor: spec.anchor, groups: spec.groups, active: this.active, preview: shown, title: spec.title ?? null } });
    }
}
