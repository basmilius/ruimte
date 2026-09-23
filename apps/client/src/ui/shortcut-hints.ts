import type { Shortcut } from '@/ui/shortcut';

/* How long the modifier has to be held on its own before every shortcut shows. */
export const HINT_DELAY_MS = 500;

export interface HintTarget {
    id: number;
    shortcut: Shortcut;
}

const targets = new Map<Element, HintTarget>();
let nextId = 0;

/* Called by every `Tooltip` whose `kbd` is a real shortcut; a phrase about a key is no shortcut to print. */
export const registerShortcutHint = (element: Element, shortcut: Shortcut): (() => void) => {
    nextId += 1;
    targets.set(element, { id: nextId, shortcut });
    return () => {
        targets.delete(element);
    };
};

export const shortcutHintTargets = (): ReadonlyMap<Element, HintTarget> => targets;

export type HoldKey = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'repeat'>;

/*
 * Whether the hints are up: the platform's modifier (Cmd on macOS, Ctrl elsewhere) held on its own for
 * `HINT_DELAY_MS`. Any other key, the modifier coming up or the caller cancelling takes them down, so
 * a shortcut pressed in passing never flashes them.
 */
export class ModifierHold {
    private readonly apple: boolean;
    private readonly onChange: (shown: boolean) => void;
    private timer: ReturnType<typeof setTimeout> | null = null;
    private shown = false;

    constructor(apple: boolean, onChange: (shown: boolean) => void) {
        this.apple = apple;
        this.onChange = onChange;
    }

    keyDown(event: HoldKey): void {
        // A repeat is the key still held; only a fresh press starts the wait.
        if (event.repeat && event.key === this.modifierKey()) {
            return;
        }
        this.cancel();
        if (event.key === this.modifierKey() && !this.otherModifierHeld(event)) {
            this.timer = setTimeout(() => {
                this.timer = null;
                this.shown = true;
                this.onChange(true);
            }, HINT_DELAY_MS);
        }
    }

    keyUp(event: Pick<KeyboardEvent, 'key'>): void {
        if (event.key === this.modifierKey()) {
            this.cancel();
        }
    }

    cancel(): void {
        if (this.timer !== null) {
            clearTimeout(this.timer);
            this.timer = null;
        }
        if (this.shown) {
            this.shown = false;
            this.onChange(false);
        }
    }

    private modifierKey(): string {
        return this.apple ? 'Meta' : 'Control';
    }

    private otherModifierHeld(event: HoldKey): boolean {
        return event.altKey || event.shiftKey || (this.apple ? event.ctrlKey : event.metaKey);
    }
}

export interface HintRect {
    left: number;
    right: number;
    top: number;
    bottom: number;
}

export interface HintPlacement {
    left?: number;
    right?: number;
    top: number;
    translateX: '0' | '-50%';
    translateY: '0' | '-100%';
}

const HINT_GAP_PX = 2;
/* Room a hint needs to be centered under its button; nearer a window edge it lines up with that edge instead. */
const EDGE_ROOM_PX = 48;
const HINT_HEIGHT_PX = 24;

/* Under the button, centered, and above it where the window ends first. */
export const placeHint = (rect: HintRect, viewport: { width: number; height: number }): HintPlacement => {
    const below = rect.bottom + HINT_GAP_PX + HINT_HEIGHT_PX <= viewport.height;
    const top = Math.round(below ? rect.bottom + HINT_GAP_PX : rect.top - HINT_GAP_PX);
    const translateY = below ? '0' : '-100%';
    const center = (rect.left + rect.right) / 2;
    if (center < EDGE_ROOM_PX) {
        return { left: Math.round(rect.left), top, translateX: '0', translateY };
    }
    if (center > viewport.width - EDGE_ROOM_PX) {
        return { right: Math.round(viewport.width - rect.right), top, translateX: '0', translateY };
    }
    return { left: Math.round(center), top, translateX: '-50%', translateY };
};
