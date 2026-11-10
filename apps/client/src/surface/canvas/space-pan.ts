import { isInFloatingLayer } from '@adecore/ui';

/* What a space press works rather than pans: a control it presses or toggles. */
const SPACE_CONTROLS = [
    'button',
    'input',
    'select',
    'summary',
    '[role="button"]',
    '[role="switch"]',
    '[role="checkbox"]',
    '[role="radio"]',
    '[role="tab"]',
    '[role="option"]',
    '[role="menuitem"]',
    '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]'
].join(', ');

/*
 * Space turns the pointer into a pan. There is one keyboard, so this is one flag for the window
 * rather than a ref per cell: the canvas the pointer goes down in is the one that pans, and which
 * one that is, is a question the pointer answers and not the key.
 */
let spaceDown = false;
const listeners = new Set<() => void>();

export function subscribeSpacePan(listener: () => void): () => void {
    listeners.add(listener);
    return () => listeners.delete(listener);
}

function setSpaceDown(down: boolean): void {
    if (spaceDown === down) {
        return;
    }
    spaceDown = down;
    for (const listener of listeners) {
        listener();
    }
}

export function isSpaceDown(): boolean {
    return spaceDown;
}

export function holdSpace(): void {
    setSpaceDown(true);
}

export function releaseSpace(): void {
    setSpaceDown(false);
}

/* Whether a space press belongs to what has the focus: a control it works, or anything in a popup or a dialog. */
export function spaceWorksTarget(target: EventTarget | null): boolean {
    return (target instanceof Element && target.closest(SPACE_CONTROLS) !== null) || isInFloatingLayer(target);
}

/*
 * A space that goes up while another app or a page's guest has the keyboard never reaches this
 * window, so losing the focus or the screen lets go of it as well.
 */
export function followSpaceRelease(
    windowTarget: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = window,
    documentTarget: Pick<EventTarget, 'addEventListener' | 'removeEventListener'> = document
): () => void {
    windowTarget.addEventListener('blur', releaseSpace);
    documentTarget.addEventListener('visibilitychange', releaseSpace);
    return () => {
        windowTarget.removeEventListener('blur', releaseSpace);
        documentTarget.removeEventListener('visibilitychange', releaseSpace);
    };
}
