import { create } from 'zustand';
import { desktop } from '@/desktop/bridge';

/* A main-frame load that did not arrive, in Chromium's own terms. What to say about it is
   `classifyLoadError`; the registry only reports what happened. */
export interface LoadFailure {
    url: string;
    code: number;
    description: string;
}

interface BrowserState {
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    /* The page's own icon, kept per node and written to the project's local file, so a row shows it
       again before the page is back. Null while the page has none. */
    favicon: string | null;
    /* The load that failed, until the next one starts. */
    error: LoadFailure | null;
}

interface BrowserStore {
    byNodeId: Record<string, BrowserState>;
    patch(nodeId: string, patch: Partial<BrowserState>): void;
    forget(nodeId: string): void;
    /* The favicons the project's local file remembers, put back before any page has loaded. */
    loadFavicons(favicons: Record<string, string>): void;
}

export const useBrowser = create<BrowserStore>((set) => ({
    byNodeId: {},
    patch(nodeId, patch) {
        set((s) => ({ byNodeId: { ...s.byNodeId, [nodeId]: { ...(s.byNodeId[nodeId] ?? EMPTY), ...patch } } }));
    },
    forget(nodeId) {
        set((s) => {
            const next = { ...s.byNodeId };
            delete next[nodeId];
            return { byNodeId: next };
        });
    },
    loadFavicons(favicons) {
        set((s) => {
            const next = { ...s.byNodeId };
            for (const [nodeId, favicon] of Object.entries(favicons)) {
                next[nodeId] = { ...(next[nodeId] ?? EMPTY), favicon };
            }
            return { byNodeId: next };
        });
    }
}));

/* What the project's local file keeps of the pages: one icon per node, and only the ones there are. */
export const faviconsOfProject = (byNodeId: Record<string, BrowserState>): Record<string, string> => {
    const favicons: Record<string, string> = {};
    for (const [nodeId, state] of Object.entries(byNodeId)) {
        if (state.favicon) {
            favicons[nodeId] = state.favicon;
        }
    }
    return favicons;
};

const EMPTY: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, favicon: null, error: null };

// Electron's <webview> as far as the registry uses it; the tag has no DOM typings of its own.
interface WebviewElement extends HTMLElement {
    src: string;
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
}

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
const normalizeUrl = (input: string): string => {
    const trimmed = input.trim();
    if (trimmed === '') {
        return 'about:blank';
    }
    if (/^[a-z][a-z0-9+.-]*:/i.test(trimmed)) {
        return trimmed;
    }
    if (/^localhost(:\d+)?(\/|$)/.test(trimmed) || /^\d+\.\d+\.\d+\.\d+/.test(trimmed)) {
        return `http://${trimmed}`;
    }
    return `https://${trimmed}`;
};

/*
 * The webview elements, one per browser node, created once and never re-parented: Chromium
 * throws the page away when a <webview> leaves the DOM, so a project switch, a view switch and a
 * page that scrolls off the canvas all hide it instead. `WebviewParking` holds and places the
 * hosts they sit in; this registry owns the elements.
 */
class BrowserRegistry {
    private readonly elements = new Map<string, WebviewElement>();

    has(nodeId: string): boolean {
        return this.elements.has(nodeId);
    }

    /* The element for a node, made on first use with the given page. */
    ensure(nodeId: string, initialUrl: string): WebviewElement | null {
        const existing = this.elements.get(nodeId);
        if (existing) {
            return existing;
        }
        if (!desktop()) {
            return null;
        }
        const element = document.createElement('webview') as WebviewElement;
        // Only settings that turn something on: an Electron webview attribute counts as set the moment
        // it is there, so `allowpopups="false"` would be popups switched on. A page here opens nothing.
        element.setAttribute('partition', 'persist:ruimte');
        element.style.width = '100%';
        element.style.height = '100%';
        // What shows until the page paints. A page with a background of its own covers it at once.
        element.style.backgroundColor = 'var(--bg)';
        element.src = normalizeUrl(initialUrl);
        this.listen(nodeId, element);
        this.elements.set(nodeId, element);
        useBrowser.getState().patch(nodeId, { url: element.src, loading: true });
        return element;
    }

    get(nodeId: string): WebviewElement | undefined {
        return this.elements.get(nodeId);
    }

    /* Which node a guest page belongs to. The shell knows its pages by web contents id only. */
    nodeIdOfContents(webContentsId: number): string | null {
        for (const [nodeId, element] of this.elements) {
            try {
                if (element.getWebContentsId() === webContentsId) {
                    return nodeId;
                }
            } catch {
                // The guest is not attached yet, so it is not the one that asked.
            }
        }
        return null;
    }

    navigate(nodeId: string, input: string): void {
        const element = this.elements.get(nodeId);
        if (!element) {
            return;
        }
        const url = normalizeUrl(input);
        useBrowser.getState().patch(nodeId, { url, error: null });
        element.loadURL(url).catch(() => undefined);
    }

    back(nodeId: string): void {
        this.elements.get(nodeId)?.goBack();
    }

    forward(nodeId: string): void {
        this.elements.get(nodeId)?.goForward();
    }

    /* Ends a navigation that is still running. The guest answers with `did-stop-loading`, so the
       bar and the button come back on their own. */
    stop(nodeId: string): void {
        this.elements.get(nodeId)?.stop();
    }

    reload(nodeId: string, ignoreCache: boolean): void {
        const element = this.elements.get(nodeId);
        if (!element) {
            return;
        }
        useBrowser.getState().patch(nodeId, { error: null });
        if (ignoreCache) {
            element.reloadIgnoringCache();
        } else {
            element.reload();
        }
    }

    inspect(nodeId: string): void {
        const element = this.elements.get(nodeId);
        if (element) {
            try {
                desktop()?.openGuestDevTools(element.getWebContentsId());
            } catch {
                // The guest is not ready yet; nothing to inspect.
            }
        }
    }

    /* Ends the page for good; used when the node is deleted, never when a project switches. */
    destroy(nodeId: string): void {
        const element = this.elements.get(nodeId);
        if (!element) {
            return;
        }
        this.elements.delete(nodeId);
        element.remove();
        useBrowser.getState().forget(nodeId);
    }

    private listen(nodeId: string, element: WebviewElement): void {
        const patch = (value: Partial<BrowserState>): void => useBrowser.getState().patch(nodeId, value);
        const sync = (): void => {
            const url = element.getURL();
            const previous = useBrowser.getState().byNodeId[nodeId]?.url ?? '';
            patch({
                url,
                title: element.getTitle(),
                canGoBack: element.canGoBack(),
                canGoForward: element.canGoForward(),
                // Another site is another icon; a site that declares none would keep the last one.
                ...(originOf(url) === originOf(previous) ? {} : { favicon: null })
            });
        };
        // The plate goes at the start of a load and nowhere else: a failed navigation leaves Chromium
        // on its own error page under the address that failed, so clearing it from `did-navigate`
        // would wipe the plate the moment it appears.
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
    }
}

export const browserRegistry = new BrowserRegistry();
