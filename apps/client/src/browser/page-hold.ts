import type { BrowserDriveEvent, BrowserDriveResult, BrowserPageState } from '@ruimte/contracts';
import { browserRegistry, useBrowser, type BrowserState } from '@/browser/registry';
import { endpointKey, isOfEndpoint, splitKey } from '@/state/keys';
import { watchPool } from '@/transport/pool-watch';
import type { Transport } from '@/transport/transport';

/* How long a page is given to come to rest before this client answers with wherever it got to. Under
   the daemon's own wait, so an agent hears the page and not a timer. */
const LOAD_TIMEOUT_MS = 10_000;

/* A navigation that never starts (an anchor on the page it is already on) is over by doing nothing. */
const START_TIMEOUT_MS = 1_500;

/* What the daemon is told about a page this client holds; the icon and the stream are the client's own. */
export const pageStateOf = (browserId: string, row: BrowserState): BrowserPageState => ({
    browserId,
    url: row.url,
    title: row.title,
    loading: row.loading,
    canGoBack: row.canGoBack,
    canGoForward: row.canGoForward,
    error: row.error === null ? row.streamError : `${row.error.description} (${row.error.code})`
});

const base64 = (bytes: Uint8Array): string => {
    let binary = '';
    for (let offset = 0; offset < bytes.length; offset += 0x8000) {
        binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
    }
    return btoa(binary);
};

/* Resolves once the page stopped loading, or once it is clear that nothing started loading at all. */
const settled = (key: string): Promise<void> =>
    new Promise((resolve) => {
        const timers: ReturnType<typeof setTimeout>[] = [];
        let started = useBrowser.getState().byKey[key]?.loading === true;
        let off = (): void => undefined;
        const done = (): void => {
            for (const timer of timers) {
                clearTimeout(timer);
            }
            off();
            resolve();
        };
        off = useBrowser.subscribe((state) => {
            const row = state.byKey[key];
            if (!row) {
                done();
                return;
            }
            if (row.loading) {
                started = true;
            } else if (started) {
                done();
            }
        });
        timers.push(
            setTimeout(() => {
                if (!started) {
                    done();
                }
            }, START_TIMEOUT_MS),
            setTimeout(done, LOAD_TIMEOUT_MS)
        );
    });

/* One ask from an agent, carried out on the page this client holds under that node. */
const answer = async (endpointId: string, event: BrowserDriveEvent): Promise<BrowserDriveResult> => {
    const key = endpointKey(endpointId, event.browserId);
    if (!browserRegistry.has(key)) {
        return { askId: event.askId, error: 'This client no longer has that page open' };
    }
    const state = (): BrowserPageState | undefined => {
        const row = useBrowser.getState().byKey[key];
        return row === undefined ? undefined : pageStateOf(event.browserId, row);
    };
    const action = event.action;
    if (action.kind === 'shot') {
        const image = await browserRegistry.capture(key);
        return image === null
            ? { askId: event.askId, state: state(), error: 'This client could not photograph the page' }
            : { askId: event.askId, state: state(), image: base64(image) };
    }
    if (action.kind === 'text') {
        const text = await browserRegistry.text(key);
        return text === null
            ? { askId: event.askId, state: state(), error: 'This client could not read the text of the page' }
            : { askId: event.askId, state: state(), text };
    }
    if (action.kind === 'go') {
        browserRegistry.navigate(key, action.url);
    } else if (action.kind === 'back') {
        browserRegistry.back(key);
    } else if (action.kind === 'forward') {
        browserRegistry.forward(key);
    } else if (action.kind === 'reload') {
        browserRegistry.reload(key, action.ignoreCache === true);
    } else if (action.kind === 'stop') {
        browserRegistry.stop(key);
    }
    /* Stopping and asking where a page stands are done the moment they are said; the rest is only
       answered once the page came to rest, so the agent reads the page it asked for and not the one before it. */
    if (action.kind !== 'state' && action.kind !== 'stop') {
        await settled(key);
    }
    return { askId: event.askId, state: state() };
};

/*
 * The pages this client draws itself, kept known to the machine they belong to. In the desktop shell
 * a browser node is a <webview> in this window, so the daemon has no page of its own to drive: it
 * knows one only while this client says it holds it, and reaches it by asking back over the same link.
 *
 * Nothing here opens a link; it follows the sockets a hold already brought up.
 */
export const startPageHolds = (): (() => void) =>
    watchPool((link: Transport, endpointId: string) => {
        /* What the machine was told, per page, so a change is one message and a still page is none. */
        const told = new Map<string, BrowserState>();
        const report = (): void => {
            const rows = useBrowser.getState().byKey;
            for (const [key, row] of Object.entries(rows)) {
                if (!isOfEndpoint(key, endpointId) || !browserRegistry.has(key) || told.get(key) === row) {
                    continue;
                }
                told.set(key, row);
                void link.request('browser.hold', { state: pageStateOf(splitKey(key).id, row) }).catch(() => undefined);
            }
            for (const key of [...told.keys()]) {
                if (rows[key] === undefined || !browserRegistry.has(key)) {
                    told.delete(key);
                    void link.request('browser.release', { browserId: splitKey(key).id }).catch(() => undefined);
                }
            }
        };
        return {
            // A socket that dropped took the machine's idea of these pages with it.
            onOpen: () => {
                told.clear();
                report();
            },
            subscriptions: [
                useBrowser.subscribe(report),
                link.on('browser.drive', (payload) => {
                    void answer(endpointId, payload).then((result) => link.request('browser.driveResult', result).catch(() => undefined));
                })
            ]
        };
    });
