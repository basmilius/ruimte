/*
 * The gesture that adds a caret above or below: tap a modifier twice, hold it down the second time and
 * press an arrow, which Option does on macOS and Ctrl elsewhere. The taps have to follow each other
 * within a third of a second; the arrow can come as long as the modifier stays down.
 */

export interface GestureEvent {
    key: string;
    timeStamp: number;
    repeat?: boolean;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
}

export type GestureAction = 'above' | 'below';

/* How long the taps may be apart. */
const TAP_MS = 300;
/* A first tap this old is forgotten even by a press that comes after the slower rule. */
const FORGET_MS = 500;

export class DoubleModifierGesture {
    private firstPressed = false;
    private firstReleased = false;
    private secondPressed = false;
    private last = 0;
    private readonly modifier: 'Alt' | 'Control';

    constructor(modifier: 'Alt' | 'Control') {
        this.modifier = modifier;
    }

    reset(): void {
        this.firstPressed = false;
        this.firstReleased = false;
        this.secondPressed = false;
    }

    /* Whether the modifier is down for the second time, which is when an arrow means something. */
    get armed(): boolean {
        return this.firstPressed && this.firstReleased && this.secondPressed;
    }

    /* Another modifier held with the one that counts spoils the gesture. */
    private spoiled(event: GestureEvent): boolean {
        const others = this.modifier === 'Alt' ? event.ctrlKey || event.metaKey || event.shiftKey : event.altKey || event.metaKey || event.shiftKey;
        return others;
    }

    keydown(event: GestureEvent): GestureAction | null {
        if (event.key === this.modifier) {
            if (event.repeat === true) {
                return null;
            }
            if (this.spoiled(event)) {
                this.reset();
                return null;
            }
            if (this.firstPressed && event.timeStamp - this.last > FORGET_MS) {
                this.reset();
            }
            this.step(event, 'press');
            return null;
        }
        if (this.armed) {
            const held = this.modifier === 'Alt' ? event.altKey : event.ctrlKey;
            if (held && !this.spoiled(event) && (event.key === 'ArrowUp' || event.key === 'ArrowDown')) {
                return event.key === 'ArrowUp' ? 'above' : 'below';
            }
            return null;
        }
        this.reset();
        return null;
    }

    keyup(event: GestureEvent): void {
        if (event.key === this.modifier) {
            if (this.spoiled(event)) {
                this.reset();
                return;
            }
            this.step(event, 'release');
        } else if (!this.armed) {
            this.reset();
        }
    }

    private step(event: GestureEvent, kind: 'press' | 'release'): void {
        if (this.firstPressed && event.timeStamp - this.last > TAP_MS) {
            this.reset();
            return;
        }
        if (kind === 'press') {
            if (!this.firstPressed) {
                this.reset();
                this.firstPressed = true;
                this.last = event.timeStamp;
            } else if (this.firstReleased) {
                this.secondPressed = true;
                this.last = event.timeStamp;
            } else {
                this.reset();
            }
            return;
        }
        if (this.firstPressed && !this.firstReleased) {
            this.firstReleased = true;
            this.last = event.timeStamp;
        } else {
            this.reset();
        }
    }
}
