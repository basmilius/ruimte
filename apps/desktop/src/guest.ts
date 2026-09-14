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
const pageTakesHorizontal = (event: WheelEvent): boolean => {
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
};

/* `momentum` is new in Chromium 151 and not in the DOM typings yet: true once the fingers are off. */
type MomentumWheelEvent = WheelEvent & { momentum?: boolean };

const onWheel = (event: MomentumWheelEvent): void => {
    const horizontal = event.deltaX !== 0 && event.momentum !== true;
    ipcRenderer.sendToHost('ruimte:wheel', {
        deltaX: event.deltaX,
        deltaY: event.deltaY,
        momentum: event.momentum === true,
        handled: event.defaultPrevented,
        // Only worth the style walk for a sample that can still start or steer a swipe.
        pageTakes: horizontal && pageTakesHorizontal(event)
    });
};

let listening = false;

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
