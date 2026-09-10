import { create } from 'zustand';
import { desktop } from '@/desktop/bridge';

interface BrowserState {
    url: string;
    title: string;
    loading: boolean;
    canGoBack: boolean;
    canGoForward: boolean;
    /* What went wrong with the last load, in the page's words. */
    error: string | null;
}

interface BrowserStore {
    byNodeId: Record<string, BrowserState>;
    patch(nodeId: string, patch: Partial<BrowserState>): void;
    forget(nodeId: string): void;
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
    }
}));

const EMPTY: BrowserState = { url: '', title: '', loading: false, canGoBack: false, canGoForward: false, error: null };

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
    reload(): void;
    reloadIgnoringCache(): void;
    loadURL(url: string): Promise<void>;
    getWebContentsId(): number;
}

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
 * throws the page away when a <webview> leaves the DOM, so a project switch must hide it
 * instead. The layer in the canvas positions them; this registry owns them.
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
        element.src = normalizeUrl(initialUrl);
        this.listen(nodeId, element);
        this.elements.set(nodeId, element);
        useBrowser.getState().patch(nodeId, { url: element.src, loading: true });
        return element;
    }

    get(nodeId: string): WebviewElement | undefined {
        return this.elements.get(nodeId);
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
        const sync = (): void =>
            patch({ url: element.getURL(), title: element.getTitle(), canGoBack: element.canGoBack(), canGoForward: element.canGoForward() });
        element.addEventListener('did-start-loading', () => patch({ loading: true }));
        element.addEventListener('did-stop-loading', () => {
            patch({ loading: false });
            sync();
        });
        element.addEventListener('did-navigate', sync);
        element.addEventListener('did-navigate-in-page', sync);
        element.addEventListener('page-title-updated', sync);
        element.addEventListener('did-fail-load', (event) => {
            const detail = event as unknown as { errorCode: number; errorDescription: string; validatedURL: string; isMainFrame: boolean };
            if (detail.errorCode === ABORTED || !detail.isMainFrame) {
                return;
            }
            patch({ loading: false, error: `${detail.errorDescription.replace(/^ERR_/, '').replaceAll('_', ' ').toLowerCase()} (${detail.validatedURL})` });
        });
    }
}

export const browserRegistry = new BrowserRegistry();
