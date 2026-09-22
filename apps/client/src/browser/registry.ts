import { create } from 'zustand';
import { feedWheel, IDLE_SWIPE, settleSwipe, SWIPE_GESTURE_GAP_MS, type SwipeOutcome, type SwipeState, type WheelSample } from '@/browser/swipe';
import { useSwipeOverlay } from '@/browser/swipe-overlay';
import { canSwipeBetweenPages, desktop } from '@/desktop/bridge';
import { useSettings } from '@/state/settings';
import { dropEndpoint, endpointKey, isOfEndpoint, splitKey, useEndpointId } from '@/state/keys';

/* A main-frame load that did not arrive, in Chromium's own terms. What to say about it is
   `classifyLoadError`; the registry only reports what happened. */
export interface LoadFailure {
    url: string;
    code: number;
    description: string;
}

export interface BrowserState {
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    /* The page's own icon, kept per node and written to this client's project state, so a row shows
       it again before the page is back. Null while the page has none. */
    favicon: string | null;
    /* The load that failed, until the next one starts. */
    error: LoadFailure | null;
    /* A server-rendered page can fail before Chromium has a Chromium error code. */
    streamError: string | null;
    streamId: string | null;
}

interface BrowserStore {
    /* Keyed with `endpointKey`, so two projects on two machines never share a page. */
    byKey: Record<string, BrowserState>;
    patch(key: string, patch: Partial<BrowserState>): void;
    forget(key: string): void;
    /* The favicons this client remembers for the project, put back before any page has loaded. */
    loadFavicons(endpointId: string, favicons: Record<string, string>): void;
    /* A machine that is forgotten takes its pages with it. */
    clear(endpointId: string): void;
}

export const useBrowser = create<BrowserStore>((set) => ({
    byKey: {},
    patch(key, patch) {
        set((s) => ({ byKey: { ...s.byKey, [key]: { ...(s.byKey[key] ?? EMPTY), ...patch } } }));
    },
    forget(key) {
        set((s) => {
            const next = { ...s.byKey };
            delete next[key];
            return { byKey: next };
        });
    },
    loadFavicons(endpointId, favicons) {
        set((s) => {
            const next = { ...s.byKey };
            for (const [nodeId, favicon] of Object.entries(favicons)) {
                const key = endpointKey(endpointId, nodeId);
                next[key] = { ...(next[key] ?? EMPTY), favicon };
            }
            return { byKey: next };
        });
    },
    clear(endpointId) {
        set((s) => ({ byKey: dropEndpoint(s.byKey, endpointId) }));
    }
}));

/* What one browser node shows, on the machine in scope. */
export const useBrowserRow = <T>(nodeId: string, select: (row: BrowserState | undefined) => T): T => {
    const endpointId = useEndpointId();
    return useBrowser((s) => select(s.byKey[endpointKey(endpointId, nodeId)]));
};

/* What this client keeps of the pages, one icon per node of this endpoint, only the ones there are. */
export const faviconsOfProject = (byKey: Record<string, BrowserState>, endpointId: string): Record<string, string> => {
    const favicons: Record<string, string> = {};
    for (const [key, state] of Object.entries(byKey)) {
        if (state.favicon && isOfEndpoint(key, endpointId)) {
            favicons[splitKey(key).id] = state.favicon;
        }
    }
    return favicons;
};

const EMPTY: BrowserState = {
    url: '',
    title: '',
    loading: false,
    canGoBack: false,
    canGoForward: false,
    favicon: null,
    error: null,
    streamError: null,
    streamId: null
};

// Electron's <webview> as far as the registry uses it; the tag has no DOM typings of its own.
interface WebviewElement extends HTMLElement {
    partition: string;
    getURL(): string;
    getTitle(): string;
    canGoBack(): boolean;
    canGoForward(): boolean;
    goBack(): void;
    goForward(): void;
    stop(): void;
    reload(): void;
    reloadIgnoringCache(): void;
    loadURL(url: string): Promise<void>;
    getWebContentsId(): number;
    send(channel: string, ...args: unknown[]): void;
}

/* What the guest preload sends to its element (`apps/desktop/src/guest.ts`). */
interface GuestMessage {
    channel: string;
    args: unknown[];
}

const isWheelSample = (value: unknown): value is WheelSample => {
    const sample = value as Partial<WheelSample> | null;
    return (
        typeof sample === 'object' &&
        sample !== null &&
        typeof sample.deltaX === 'number' &&
        typeof sample.deltaY === 'number' &&
        typeof sample.momentum === 'boolean' &&
        typeof sample.handled === 'boolean' &&
        typeof sample.pinch === 'boolean' &&
        typeof sample.pageTakes === 'boolean'
    );
};

/* Whether pages report their wheel at all, the setting on the one platform the gesture belongs to. */
const swipesOn = (): boolean => canSwipeBetweenPages() && useSettings.getState().browserSwipe;

/* The site a page belongs to, or the address itself when it has no host to compare. */
const originOf = (url: string): string => {
    try {
        return new URL(url).origin;
    } catch {
        return url;
    }
};

// A load the page itself cancelled (a redirect, a new navigation) is not an error worth a banner.
const ABORTED = -3;

/* Adds a scheme when the person typed a bare host; anything with one is used as is. */
export const normalizeUrl = (input: string): string => {
    const trimmed = input.trim();
    if (trimmed === '') {
        return 'about:blank';
    }
    if (/^localhost(:\d+)?(\/|$)/.test(trimmed) || /^\d+\.\d+\.\d+\.\d+/.test(trimmed)) {
        return `http://${trimmed}`;
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
        return trimmed;
    }
    return `https://${trimmed}`;
};

export const initialStreamUrl = (savedUrl: string, observedUrl?: string): string => (observedUrl && observedUrl !== 'about:blank' ? observedUrl : savedUrl);

/* A webview is a custom element. Before it is connected, assigning its `src` property can shadow
   Electron's property setter; an attribute survives the upgrade and starts the first navigation. */
export const setInitialWebviewUrl = (element: Pick<HTMLElement, 'setAttribute'>, initialUrl: string): string => {
    const url = normalizeUrl(initialUrl);
    element.setAttribute('src', url);
    return url;
};

/*
 * The webview elements, one per browser node, created once and never re-parented. Chromium
 * throws the page away when a <webview> leaves the DOM, so a project switch, a view switch and a
 * page that scrolls off the canvas all hide it instead. `WebviewParking` holds and places the
 * hosts they sit in; this registry owns the elements.
 */
class BrowserRegistry {
    /* Keyed with `endpointKey`, the way the store above is, since a page belongs to a node of one machine. */
    private readonly elements = new Map<string, WebviewElement>();
    private readonly swipes = new Map<string, SwipeState>();
    private readonly settleTimers = new Map<string, ReturnType<typeof setTimeout>>();
    private watchingSwipeSetting = false;

    has(key: string): boolean {
        return this.elements.has(key);
    }

    /* The element for a node, made on first use with the given page. */
    ensure(key: string, initialUrl: string): WebviewElement | null {
        const existing = this.elements.get(key);
        if (existing) {
            return existing;
        }
        if (!desktop()) {
            return null;
        }
        const element = document.createElement('webview') as WebviewElement;
        // Only sets attributes that turn something on. An Electron webview attribute counts as set the
        // moment it is there, so `allowpopups="false"` would turn popups on. A page here opens nothing.
        element.setAttribute('partition', 'persist:ruimte');
        element.style.width = '100%';
        element.style.height = '100%';
        // What shows until the page paints. A page with a background of its own covers it at once.
        element.style.backgroundColor = 'var(--bg)';
        const url = setInitialWebviewUrl(element, initialUrl);
        this.watchSwipeSetting();
        this.listen(key, element);
        this.elements.set(key, element);
        useBrowser.getState().patch(key, { url, loading: true });
        return element;
    }

    get(key: string): WebviewElement | undefined {
        return this.elements.get(key);
    }

    /* Which node a guest page belongs to, as a key. The shell knows its pages by web contents id only. */
    keyOfContents(webContentsId: number): string | null {
        for (const [key, element] of this.elements) {
            try {
                if (element.getWebContentsId() === webContentsId) {
                    return key;
                }
            } catch {
                // The guest is not attached yet, so it is not the one that asked.
            }
        }
        return null;
    }

    navigate(key: string, input: string): void {
        const element = this.elements.get(key);
        if (!element) {
            return;
        }
        const url = normalizeUrl(input);
        useBrowser.getState().patch(key, { url, error: null });
        element.loadURL(url).catch(() => undefined);
    }

    back(key: string): void {
        this.elements.get(key)?.goBack();
    }

    forward(key: string): void {
        this.elements.get(key)?.goForward();
    }

    /* Ends a navigation that is still running. The guest answers with `did-stop-loading`, so the
       bar and the button come back on their own. */
    stop(key: string): void {
        this.elements.get(key)?.stop();
    }

    reload(key: string, ignoreCache: boolean): void {
        const element = this.elements.get(key);
        if (!element) {
            return;
        }
        useBrowser.getState().patch(key, { error: null });
        if (ignoreCache) {
            element.reloadIgnoringCache();
        } else {
            element.reload();
        }
    }

    inspect(key: string): void {
        const element = this.elements.get(key);
        if (element) {
            try {
                desktop()?.openGuestDevTools(element.getWebContentsId());
            } catch {
                // The guest is not ready yet; nothing to inspect.
            }
        }
    }

    /* Ends the page for good; used when the node is deleted, never when a project switches. */
    destroy(key: string): void {
        const element = this.elements.get(key);
        if (!element) {
            return;
        }
        this.elements.delete(key);
        element.remove();
        useBrowser.getState().forget(key);
        this.endSwipe(key);
        useSwipeOverlay.getState().forget(key);
    }

    private listen(key: string, element: WebviewElement): void {
        const patch = (value: Partial<BrowserState>): void => useBrowser.getState().patch(key, value);
        const sync = (): void => {
            const url = element.getURL();
            const previous = useBrowser.getState().byKey[key]?.url ?? '';
            patch({
                url,
                title: element.getTitle(),
                canGoBack: element.canGoBack(),
                canGoForward: element.canGoForward(),
                // Another site is another icon; a site that declares none would keep the last one.
                ...(originOf(url) === originOf(previous) ? {} : { favicon: null })
            });
        };
        // Clear the error at load start; `did-navigate` also fires for Chromium's failure page.
        element.addEventListener('did-start-loading', () => patch({ loading: true, error: null }));
        element.addEventListener('did-stop-loading', () => {
            patch({ loading: false });
            sync();
        });
        element.addEventListener('did-navigate', sync);
        element.addEventListener('did-navigate-in-page', sync);
        element.addEventListener('page-title-updated', sync);
        element.addEventListener('page-favicon-updated', (event) => {
            // Chromium lists them smallest first; the last one is the one worth drawing at 16px.
            const detail = event as unknown as { favicons?: string[] };
            const favicon = detail.favicons?.at(-1);
            if (favicon) {
                patch({ favicon });
            }
        });
        element.addEventListener('did-fail-load', (event) => {
            const detail = event as unknown as { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean };
            if (detail.errorCode === ABORTED || !detail.isMainFrame) {
                return;
            }
            patch({ loading: false, error: { url: detail.validatedURL, code: detail.errorCode, description: detail.errorDescription } });
        });
        // Every new document runs the preload again, and it starts out not listening to the wheel.
        element.addEventListener('dom-ready', () => this.tellGuest(element));
        element.addEventListener('ipc-message', (event) => {
            const message = event as unknown as GuestMessage;
            const [payload] = message.args;
            if (message.channel === 'ruimte:navigate') {
                if (payload === 'back') {
                    this.back(key);
                } else if (payload === 'forward') {
                    this.forward(key);
                }
            } else if (message.channel === 'ruimte:wheel' && isWheelSample(payload)) {
                this.feedSwipe(key, element, payload);
            } else if (message.channel === 'ruimte:ground' && typeof payload === 'string') {
                // A page is transparent where it paints nothing, so its own ground goes behind it.
                element.style.backgroundColor = payload;
            }
        });
    }

    /* Tells a page whether to report its wheel. A guest that is not attached yet hears it on `dom-ready`. */
    private tellGuest(element: WebviewElement): void {
        try {
            element.send('ruimte:swipe', swipesOn());
        } catch {
            // Not attached yet; `dom-ready` asks again.
        }
    }

    /* The setting reaches every page the moment it changes, so off stops the samples at the source. */
    private watchSwipeSetting(): void {
        if (this.watchingSwipeSetting) {
            return;
        }
        this.watchingSwipeSetting = true;
        useSettings.subscribe((state, before) => {
            if (state.browserSwipe === before.browserSwipe) {
                return;
            }
            for (const [key, element] of this.elements) {
                this.tellGuest(element);
                this.endSwipe(key);
                useSwipeOverlay.getState().hide(key);
            }
        });
    }

    private feedSwipe(key: string, element: WebviewElement, sample: WheelSample): void {
        // A sample that was already on its way when the setting went off.
        if (!swipesOn()) {
            return;
        }
        const history = { canGoBack: element.canGoBack(), canGoForward: element.canGoForward() };
        const result = feedWheel(this.swipes.get(key) ?? IDLE_SWIPE, sample, history, performance.now());
        this.applySwipe(key, result.state, result.outcome);
        clearTimeout(this.settleTimers.get(key));
        this.settleTimers.delete(key);
        if (result.state.phase === 'idle') {
            return;
        }
        // Fingers that stop before they lift send no momentum, so silence is what ends the gesture.
        this.settleTimers.set(
            key,
            setTimeout(() => {
                this.settleTimers.delete(key);
                const settled = settleSwipe(
                    this.swipes.get(key) ?? IDLE_SWIPE,
                    { canGoBack: element.canGoBack(), canGoForward: element.canGoForward() },
                    performance.now()
                );
                this.applySwipe(key, settled.state, settled.outcome);
            }, SWIPE_GESTURE_GAP_MS)
        );
    }

    private applySwipe(key: string, state: SwipeState, outcome: SwipeOutcome): void {
        this.swipes.set(key, state);
        const overlay = useSwipeOverlay.getState();
        if (outcome.kind === 'progress') {
            overlay.show(key, outcome.side, outcome.progress);
            return;
        }
        if (outcome.kind === 'navigate') {
            // Fades out from full, so the arrow says it went through.
            overlay.show(key, outcome.side, 1);
            overlay.hide(key);
            if (outcome.side === 'back') {
                this.back(key);
            } else {
                this.forward(key);
            }
            return;
        }
        overlay.hide(key);
    }

    private endSwipe(key: string): void {
        clearTimeout(this.settleTimers.get(key));
        this.settleTimers.delete(key);
        this.swipes.delete(key);
    }
}

export const browserRegistry = new BrowserRegistry();
