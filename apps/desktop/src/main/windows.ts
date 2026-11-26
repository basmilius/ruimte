import type { Theme, Windows } from '@adecore/shell';
import type { ThemeState } from '@adecore/shell/bridge';
import { splitAuxWindowKey } from '@ruimte/desktop-bridge';
import { auxIdsOf, isWindowKey, isWindowMessage, isWindowState, isWindowView, tabStripOf, windowPointOf } from '../app-windows';
import { electron } from '../electron';
import { createTabDrag } from '../tab-drag';
import { createViewDrag } from '../view-drag';
import type { DesktopIpc } from './ipc';

const { screen } = electron;

interface WindowChannelOptions {
    windows: Windows;
    theme: Theme;
}

/* What the next window `windows.open` creates takes along, handed to it in the same tick. */
export interface Opening {
    view: string | null;
    inactive: boolean;
}

interface WindowChannels {
    /* Taken once by the window being created, so the next one opens without it. */
    takeOpening(): Opening;
    /* Called for every new window. Every page hears of an auxiliary window that opens or goes. */
    opened(window: Electron.BrowserWindow, key: string | null): void;
    /* While the app quits, a window that closes comes back at the next start, so no page hears that a person closed it. */
    setLeaving(going: boolean): void;
}

function onScreen(at: { x: number; y: number }, size: { width: number; height: number }): { x: number; y: number } {
    const area = screen.getDisplayNearestPoint(at).workArea;
    return {
        x: Math.min(Math.max(at.x, area.x), Math.max(area.x, area.x + area.width - Math.min(size.width, area.width))),
        y: Math.min(Math.max(at.y, area.y), Math.max(area.y, area.y + area.height - Math.min(size.height, area.height)))
    };
}

export function installWindows(ipc: DesktopIpc, options: WindowChannelOptions): WindowChannels {
    const { windows, theme } = options;
    let openingView: string | null = null;
    // A window a tab tears off into opens without the focus, so the window that holds the press keeps getting its pointer.
    let openingInactive = false;
    // Where each window's page draws its tab strip, in the page's coordinates, for a tab dragged over it.
    const tabStrips = new Map<number, { x: number; y: number; width: number; height: number }>();
    const stripWatched = new WeakSet<Electron.BrowserWindow>();
    let leaving = false;

    /* A window that keeps a project as a tab it does not show is asked to show it, once it came to the front. */
    const showOnHolder = (key: string | null): void => {
        const holder = key === null ? null : windows.holderOf(key);
        if (holder !== null && windows.keyOf(holder) !== key) {
            holder.webContents.send('window:show-project', key);
        }
    };

    const tabDrag = createTabDrag<Electron.BrowserWindow>({
        detach: (window, key, at) => {
            openingInactive = true;
            try {
                return windows.detach(window, key, onScreen(at, window.getBounds()));
            } finally {
                openingInactive = false;
            }
        },
        transfer: (key, window) => windows.transfer(key, window),
        windowAt: (point, except) => windows.windowAt(point, except),
        stripOf: (window) => tabStrips.get(window.id) ?? null,
        stripX: (window, point) => {
            const strip = tabStrips.get(window.id);
            if (strip === undefined) {
                return null;
            }
            const content = window.getContentBounds();
            const x = point.x - content.x;
            const y = point.y - content.y;
            return x >= strip.x && x < strip.x + strip.width && y >= strip.y && y < strip.y + strip.height ? x : null;
        },
        cursor: () => screen.getCursorScreenPoint(),
        every: (tick) => {
            const timer = setInterval(tick, 16);
            return () => clearInterval(timer);
        },
        onFront: (window, listener) => {
            window.on('focus', listener);
            return () => window.removeListener('focus', listener);
        }
    });

    ipc.handle('window:controls', (event) => {
        const window = ipc.senderWindow(event);

        return window ? theme.windowControls(window) : { inset: null };
    });

    /*
     * A project is in one window at a time: when another window has it, that one comes to the front and
     * the page stays where it was. Null lets the window's project go.
     */
    ipc.handle('window:claim', (event, key: unknown) => {
        const window = ipc.senderWindow(event);
        if (window === null || (key !== null && !isWindowKey(key))) {
            return false;
        }
        if (windows.claim(window, key)) {
            return true;
        }
        showOnHolder(key);
        return false;
    });

    // The tabs a window keeps; a project another window keeps stays there, so the answer is what this window has.
    ipc.handle('window:hold', (event, keys: unknown) => {
        const window = ipc.senderWindow(event);
        if (window === null || !Array.isArray(keys) || keys.length > 512 || !keys.every(isWindowKey)) {
            return [];
        }
        return windows.hold(window, keys);
    });

    ipc.on('window:tab-strip', (event, rect: unknown) => {
        const window = ipc.senderWindow(event);
        if (window === null) {
            return;
        }
        const strip = tabStripOf(rect);
        if (strip === null) {
            tabStrips.delete(window.id);
            return;
        }
        // Once per window: a strip that comes and goes would stack a listener each time it came back.
        if (!stripWatched.has(window)) {
            stripWatched.add(window);
            window.once('closed', () => tabStrips.delete(window.id));
        }
        tabStrips.set(window.id, strip);
    });

    const projectOf = (key: string | null): string | null => (key === null ? null : (splitAuxWindowKey(key)?.project ?? key));

    const viewDrag = createViewDrag<Electron.BrowserWindow>({
        open: (key, at) => {
            // Without the focus, which stays with the window the drag came from until the drag ends.
            openingInactive = true;
            try {
                return windows.open(key, at);
            } finally {
                openingInactive = false;
            }
        },
        windowAt: (point, except) => windows.windowAt(point, except),
        takes: (window, key) => projectOf(windows.keyOf(window)) === projectOf(key),
        cursor: () => screen.getCursorScreenPoint(),
        every: (tick) => {
            const timer = setInterval(tick, 16);
            return () => clearInterval(timer);
        }
    });

    // The page a view is dragged out of says when the drag left its window and how it ended.
    ipc.handle('window:view-drag', (event, phase: unknown, key: unknown, keep: unknown) => {
        const window = ipc.senderWindow(event);
        if (window === null) {
            return false;
        }
        if (phase === 'end') {
            viewDrag.end(keep === true);
            return true;
        }
        // Only for a new auxiliary window of the project the asking window shows.
        const own = projectOf(windows.keyOf(window));
        if (phase !== 'start' || !isWindowKey(key) || own === null || splitAuxWindowKey(key)?.project !== own || windows.holderOf(key) !== null) {
            return false;
        }
        return viewDrag.start(key);
    });

    // The page that holds the press says when a tab leaves its window and when the press lets go.
    ipc.handle('window:tab-drag', (event, phase: unknown, key: unknown, grab: unknown, whole: unknown, tabWidth: unknown) => {
        const window = ipc.senderWindow(event);
        if (window === null) {
            return false;
        }
        if (phase === 'end') {
            tabDrag.end();
            return true;
        }
        const point = windowPointOf(grab);
        const width = typeof tabWidth === 'number' && Number.isFinite(tabWidth) && tabWidth > 0 ? tabWidth : null;
        return phase === 'start' && isWindowKey(key) && point !== undefined && tabDrag.start(window, key, point, whole === true, width);
    });

    // Null opens the start screen. A view goes in a new window's address, or as a message to one that already shows the project.
    ipc.on('window:open', (_event, key: unknown, view: unknown, at: unknown) => {
        if (key !== null && !isWindowKey(key)) {
            return;
        }
        const shown = key !== null && isWindowView(view) ? view : null;
        const holder = key === null ? null : windows.holderOf(key);
        if (holder !== null) {
            windows.open(key);
            showOnHolder(key);
            if (shown !== null) {
                holder.webContents.send('window:show-view', shown);
            }
            return;
        }
        openingView = shown;
        try {
            windows.open(key, windowPointOf(at));
        } finally {
            openingView = null;
        }
    });

    // Handed over in one tick, so nobody ever holds the project; the asking page goes to the start screen on true.
    ipc.handle('window:move-to-new', (event, at: unknown) => {
        const window = ipc.senderWindow(event);
        return window !== null && windows.move(window, windowPointOf(at)) !== null;
    });

    // A window whose last tab closed goes, as long as it is not the last window.
    ipc.handle('window:close-if-others', (event) => {
        const window = ipc.senderWindow(event);
        if (window === null || windows.all().length < 2) {
            return false;
        }
        setImmediate(() => window.close());
        return true;
    });

    // What the page keeps of itself, such as its tabs, comes back in its address at the next start.
    ipc.on('window:state', (event, state: unknown) => {
        const window = ipc.senderWindow(event);
        if (window !== null && isWindowState(state)) {
            windows.setState(window, state);
        }
    });

    ipc.on('window:theme', (_event, state: ThemeState) => theme.apply(state));

    ipc.handle('window:aux-list', (_event, project: unknown) =>
        isWindowKey(project)
            ? auxIdsOf(
                  windows.all().map((window) => windows.keyOf(window)),
                  project
              )
            : []
    );

    // The receiver trusts `from`, so it is the key the shell holds for the sender and never one the page names.
    ipc.handle('window:post', (event, to: unknown, message: unknown) => {
        const window = ipc.senderWindow(event);
        const from = window === null ? null : windows.keyOf(window);
        const target = isWindowKey(to) ? windows.holderOf(to) : null;
        if (from === null || target === null || target === window || !isWindowMessage(message) || target.webContents.isDestroyed()) {
            return false;
        }
        target.webContents.send('window:message', from, message);
        return true;
    });

    return {
        opened: (window, key) => {
            if (key === null || splitAuxWindowKey(key) === null) {
                return;
            }
            window.once('closed', () => {
                // A page asks for the list when it hears this, and the window leaves the list only after this event's handlers.
                setImmediate(() => {
                    windows.send('window:aux-changed');
                    if (!leaving) {
                        windows.send('window:aux-closed', key);
                    }
                });
            });
            setImmediate(() => windows.send('window:aux-changed'));
        },
        setLeaving: (going) => {
            leaving = going;
        },
        takeOpening: () => {
            const opening = { view: openingView, inactive: openingInactive };
            openingView = null;
            openingInactive = false;
            return opening;
        }
    };
}
