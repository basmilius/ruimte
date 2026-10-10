// A plain require: the bundler's ESM interop copies enumerable keys, and electron's are getters.
const { ipcRenderer } = require('electron') as typeof import('electron');

/*
 * The preload of every browser page, main frame only. It measures and reports; the host decides what
 * a report means (`apps/client/src/browser/swipe.ts`). A wheel event is the only place a two-finger
 * swipe shows up at all, because Electron has none of Chrome's history swiper and `input-event` in
 * the shell carries no deltas. Mirrors `GuestMessage` in `apps/client/src/browser/registry.ts`.
 */

/* Whether the page would take this horizontal movement itself: something under the pointer can
   still scroll that way, or a scroll container on the way up says overscroll is its own business. */
function pageTakesHorizontal(event: WheelEvent): boolean {
    const root = document.scrollingElement;
    for (const target of event.composedPath()) {
        if (!(target instanceof Element)) {
            continue;
        }
        const style = getComputedStyle(target);
        const isViewport = target === root;
        const scrolls = isViewport ? style.overflowX !== 'hidden' && style.overflowX !== 'clip' : style.overflowX === 'auto' || style.overflowX === 'scroll';
        const room = scrolls ? target.scrollWidth - target.clientWidth : 0;
        if (room >= 1) {
            // Right to left scrolls from 0 down to minus the room rather than from 0 up to it.
            const low = style.direction === 'rtl' ? -room : 0;
            const high = style.direction === 'rtl' ? 0 : room;
            if (event.deltaX < 0 ? target.scrollLeft > low + 1 : target.scrollLeft < high - 1) {
                return true;
            }
        }
        // A page says it about the viewport on either the root or the body, whatever their overflow.
        const claims = style.overscrollBehaviorX === 'contain' || style.overscrollBehaviorX === 'none';
        if (claims && (scrolls || isViewport || target === document.body)) {
            return true;
        }
    }
    return false;
}

/* `momentum` is new in Chromium 151 and not in the DOM typings yet: true once the fingers are off. */
type MomentumWheelEvent = WheelEvent & { momentum?: boolean };

function onWheel(event: MomentumWheelEvent): void {
    // Chromium reports a trackpad pinch as a wheel with Ctrl held.
    const pinch = event.ctrlKey;
    const horizontal = event.deltaX !== 0 && event.momentum !== true && !pinch;
    ipcRenderer.sendToHost('ruimte:wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        momentum: event.momentum === true,
        handled: event.defaultPrevented,
        pinch,
        // Only worth the style walk for a sample that can still start or steer a swipe.
        pageTakes: horizontal && pageTakesHorizontal(event)
    });
}

let listening = false;
let canvasInput = { enabled: false, pan: false };
let panPointer: number | null = null;

function endCanvasPan(): void {
    const pointer = panPointer;
    panPointer = null;
    if (pointer !== null) {
        ipcRenderer.sendToHost('ruimte:canvas-pan', { phase: 'end' });
        if (document.documentElement.hasPointerCapture(pointer)) {
            document.documentElement.releasePointerCapture(pointer);
        }
    }
}

ipcRenderer.on('ruimte:canvas-input', (_event, value: unknown) => {
    const configuration = value as { enabled?: boolean; pan?: boolean } | null;
    if (canvasInput.enabled && configuration?.enabled !== true) {
        ipcRenderer.sendToHost('ruimte:canvas-alt', false);
    }
    canvasInput = { enabled: configuration?.enabled === true, pan: configuration?.pan === true };
    if (!canvasInput.pan) {
        endCanvasPan();
    }
});

window.addEventListener(
    'pointerdown',
    (event) => {
        if (!canvasInput.pan || event.button !== 1 || panPointer !== null) {
            return;
        }
        event.preventDefault();
        event.stopImmediatePropagation();
        panPointer = event.pointerId;
        document.documentElement.setPointerCapture(event.pointerId);
        ipcRenderer.sendToHost('ruimte:canvas-pan', { phase: 'start', x: event.screenX, y: event.screenY });
    },
    true
);

window.addEventListener(
    'pointermove',
    (event) => {
        if (event.pointerId === panPointer) {
            event.preventDefault();
            event.stopImmediatePropagation();
            // Screen coordinates stay fixed while the host moves the page under the captured pointer.
            ipcRenderer.sendToHost('ruimte:canvas-pan', { phase: 'move', x: event.screenX, y: event.screenY });
        }
    },
    true
);

for (const name of ['pointerup', 'pointercancel', 'lostpointercapture'] as const) {
    window.addEventListener(
        name,
        (event) => {
            if (event.pointerId === panPointer) {
                event.preventDefault();
                event.stopImmediatePropagation();
                endCanvasPan();
            }
        },
        true
    );
}

window.addEventListener(
    'wheel',
    (event) => {
        if (panPointer !== null) {
            event.preventDefault();
            event.stopImmediatePropagation();
        }
    },
    { capture: true, passive: false }
);

window.addEventListener(
    'keydown',
    (event) => {
        if (!canvasInput.enabled) {
            return;
        }
        if (event.key === 'Alt') {
            ipcRenderer.sendToHost('ruimte:canvas-alt', true);
        }
        const apple = process.platform === 'darwin';
        if (event.code === 'Digit2' && event.shiftKey && !event.altKey && event.metaKey === apple && event.ctrlKey !== apple) {
            event.preventDefault();
            event.stopImmediatePropagation();
            ipcRenderer.sendToHost('ruimte:canvas-zoom');
        }
    },
    true
);

window.addEventListener('keydown', (event) => {
    // A page's editor or dialog gets to consume Escape before focus returns to the canvas.
    if (
        canvasInput.enabled &&
        !event.defaultPrevented &&
        event.key === 'Escape' &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey &&
        !event.shiftKey &&
        !(event.target instanceof Element && event.target.closest('input, textarea, [contenteditable]:not([contenteditable="false"]), [role="dialog"]')) &&
        !document.querySelector('dialog[open], [role="dialog"][aria-modal="true"]')
    ) {
        event.preventDefault();
        ipcRenderer.sendToHost('ruimte:canvas-leave');
    }
});

window.addEventListener(
    'keyup',
    (event) => {
        if (event.key === 'Alt' && canvasInput.enabled) {
            ipcRenderer.sendToHost('ruimte:canvas-alt', false);
        }
    },
    true
);

window.addEventListener('blur', () => {
    endCanvasPan();
    if (canvasInput.enabled) {
        ipcRenderer.sendToHost('ruimte:canvas-alt', false);
    }
});

/* The host says whether swipes are on, on every new document. Off, no listener exists at all, so a
   scroll costs a page nothing and nothing crosses to the host. */
ipcRenderer.on('ruimte:swipe', (_event, enabled: unknown) => {
    if (enabled === listening) {
        return;
    }
    listening = enabled === true;
    if (listening) {
        // Bubble phase and passive: the page gets to handle the event first, and `defaultPrevented`
        // is how a map or a canvas app says the gesture is its own.
        window.addEventListener('wheel', onWheel, { passive: true });
    } else {
        window.removeEventListener('wheel', onWheel);
    }
});

// Chromium hands a page the side buttons of a mouse and does nothing with them itself.
window.addEventListener('mouseup', (event) => {
    if (event.defaultPrevented || (event.button !== 3 && event.button !== 4)) {
        return;
    }
    ipcRenderer.sendToHost('ruimte:navigate', event.button === 3 ? 'back' : 'forward');
});

/*
 * Cmd+[ and Cmd+] (Ctrl off macOS) with the keyboard inside the page, which never reaches the client.
 * Chrome lets a page claim them first, the way an editor outdents on Cmd+[, so a prevented press
 * stays the page's. Mirrors `CANVAS_SHORTCUTS.browserBack` in `apps/client/src/canvas/shortcuts.ts`.
 */
window.addEventListener('keydown', (event) => {
    const apple = process.platform === 'darwin';
    if (event.defaultPrevented || event.shiftKey || event.altKey || event.metaKey !== apple || event.ctrlKey === apple) {
        return;
    }
    if (event.code === 'BracketLeft' || event.code === 'BracketRight') {
        ipcRenderer.sendToHost('ruimte:navigate', event.code === 'BracketLeft' ? 'back' : 'forward');
    }
});

/*
 * The CSS system color Chromium would paint under a page without a ground of its own. Without it such a
 * page shows the app's ground through, instead of the white every browser gives it.
 */
function reportGround(): void {
    // The system color can only be read off an element in the document, so one is put there for a tick.
    const probe = document.createElement('div');
    probe.style.cssText = 'background-color: Canvas; display: none';
    document.documentElement.appendChild(probe);
    const ground = getComputedStyle(probe).backgroundColor;
    probe.remove();
    ipcRenderer.sendToHost('ruimte:ground', ground);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', reportGround, { once: true });
} else {
    reportGround();
}

// A page that leaves the choice to the reader (`color-scheme: light dark`) changes ground with the app.
window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', reportGround);
