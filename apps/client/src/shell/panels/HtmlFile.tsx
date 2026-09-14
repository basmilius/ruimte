import { useCallback, useContext, useEffect, useRef, useState } from 'react';
import { Code, Eye, FileWarning } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { focusCellOfView, watchGuestFocus } from '@/browser/guest-focus';
import { isDesktop } from '@/desktop/bridge';
import { CodeFile } from '@/shell/panels/CodeFile';
import { DisabledWrapToggle, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { localFileUrl } from '@/shell/panels/file-url';
import { dirnameOf } from '@/shell/panels/files-tree';
import { useEndpoints } from '@/state/endpoints';
import { CellViewContext } from '@/state/workspace-stores';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { BTN_GROUP } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';

type HtmlView = 'preview' | 'source';

/*
 * A session of its own for previewed pages, in memory: what a page stores is gone when the app quits
 * and never touches the session the browser nodes browse in. The main process cancels every request
 * out of this partition that is not the file itself, so a script in the page cannot reach the daemon
 * (on loopback its routes need no token).
 */
const PREVIEW_PARTITION = 'preview';

// A load the page itself cancelled (a redirect, a new navigation) is not an error worth a banner.
const ABORTED = -3;

/*
 * Where each previewed page was scrolled, by path, for as long as the app runs. A tab switch throws
 * the webview away and Chromium reads nothing out of a guest that has left the DOM, so the page
 * reports its position while it scrolls, over the console: the preview partition gets no preload.
 */
const scrollPositions = new Map<string, { x: number; y: number }>();
const SCROLL_MESSAGE = 'ruimte:preview-scroll:';

const scrollScript = (restore: { x: number; y: number } | undefined): string => `(() => {
    ${restore ? `scrollTo(${restore.x}, ${restore.y});` : ''}
    if (window.__ruimteScroll) { return; }
    window.__ruimteScroll = true;
    let timer;
    addEventListener('scroll', () => {
        clearTimeout(timer);
        timer = setTimeout(() => console.debug(${JSON.stringify(SCROLL_MESSAGE)} + Math.round(scrollX) + ',' + Math.round(scrollY)), 50);
    }, { passive: true });
})()`;

// Electron's <webview> as far as this panel uses it; the tag has no DOM typings of its own.
interface PreviewWebview extends HTMLElement {
    src: string;
    reload(): void;
    executeJavaScript(code: string): Promise<unknown>;
}

interface FailedLoad {
    errorCode: number;
    errorDescription: string;
    isMainFrame: boolean;
}

/* Chromium's `ERR_FILE_NOT_FOUND` in words a person reads. */
const describeFailure = (description: string): string => description.replace(/^ERR_/, '').replaceAll('_', ' ').toLowerCase();

/*
 * An HTML file as the page it is, with the source a click away. The page runs in a <webview> that the
 * desktop shell provides, loaded from a `file://` URL so the stylesheet and the images next to it
 * resolve the way they do when the file is opened from Finder. That URL only means something while
 * the daemon runs on this machine, so a remote endpoint gets the source and says why.
 */
export function HtmlFile({ path, name, read }: { path: string; name: string; read: FsReadText }) {
    const onDesktop = isDesktop();
    const onThisMachine = useEndpoints((s) => s.endpoints.find((endpoint) => endpoint.id === s.activeId)?.reachability === 'loopback');
    const canPreview = onDesktop && onThisMachine;
    const [view, setView] = useState<HtmlView>(canPreview ? 'preview' : 'source');
    const [loading, setLoading] = useState(canPreview);
    const [error, setError] = useState<string | null>(null);
    const transport = useTransport();
    const host = useRef<HTMLDivElement>(null);
    const page = useRef<PreviewWebview | null>(null);
    /* The cell this preview stands in, or null in the preview panel, which is no cell at all. */
    const cell = useContext(CellViewContext);
    const url = localFileUrl(path);

    useEffect(() => {
        const parent = host.current;
        if (!canPreview || !parent) {
            return;
        }
        const element = document.createElement('webview') as PreviewWebview;
        element.setAttribute('partition', PREVIEW_PARTITION);
        // Only settings that turn something on: an Electron webview attribute counts as set the moment
        // it is there, so `nodeintegration="false"` would be node integration switched on.
        element.setAttribute('webpreferences', 'sandbox=yes,contextIsolation=yes');
        // Without it a `target="_blank"` link never reaches the shell, which opens it in the system
        // browser and denies the window itself.
        element.setAttribute('allowpopups', '');
        element.className = 'file-preview-page';
        element.addEventListener('did-start-loading', () => {
            setLoading(true);
            setError(null);
        });
        element.addEventListener('did-stop-loading', () => {
            // Only the first load goes back to where the tab was; a reload keeps its own scroll.
            const restore = element.dataset.loaded === undefined ? scrollPositions.get(path) : undefined;
            element.dataset.loaded = '';
            setLoading(false);
            element.executeJavaScript(scrollScript(restore)).catch(() => {});
        });
        element.addEventListener('console-message', (event) => {
            const message = (event as unknown as { message: string }).message;
            if (!message.startsWith(SCROLL_MESSAGE)) {
                return;
            }
            const [x, y] = message.slice(SCROLL_MESSAGE.length).split(',').map(Number);
            if (Number.isFinite(x) && Number.isFinite(y)) {
                scrollPositions.set(path, { x, y });
            }
        });
        element.addEventListener('did-fail-load', (event) => {
            const detail = event as unknown as FailedLoad;
            if (detail.errorCode === ABORTED || !detail.isMainFrame) {
                return;
            }
            setLoading(false);
            setError(describeFailure(detail.errorDescription));
        });
        element.src = url;
        parent.appendChild(element);
        page.current = element;
        const offFocus = cell === null ? null : watchGuestFocus(element, () => focusCellOfView(cell));
        return () => {
            offFocus?.();
            page.current = null;
            element.remove();
        };
    }, [canPreview, url, path, cell]);

    useEffect(() => {
        if (!canPreview) {
            return;
        }
        const folder = dirnameOf(path);
        return transport.on('fs.changed', (payload) => {
            // Anything under the file's folder counts: a stylesheet the page pulls in changes the page.
            if (payload.paths.some((changed) => changed === folder || changed.startsWith(`${folder}/`))) {
                page.current?.reload();
            }
        });
    }, [transport, canPreview, path]);

    const retry = useCallback(() => {
        setError(null);
        page.current?.reload();
    }, []);

    let previewLabel = 'Preview';
    if (!onDesktop) {
        previewLabel = 'Preview needs the desktop app';
    } else if (!onThisMachine) {
        previewLabel = 'Preview needs the file on this machine';
    }

    const controls = (
        <>
            {onDesktop && !onThisMachine && <span className="text-xs text-text-muted">Preview needs the file on this machine</span>}
            <div className={BTN_GROUP}>
                <FileToolbarToggle icon={Eye} label={previewLabel} active={view === 'preview'} disabled={!canPreview} onClick={() => setView('preview')} />
                <FileToolbarToggle icon={Code} label="Source" active={view === 'source'} onClick={() => setView('source')} />
            </div>
        </>
    );

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {view === 'source' ? (
                <CodeFile name={name} read={read} toolbarExtra={controls} />
            ) : (
                <FileToolbar>
                    {controls}
                    <Separator />
                    <DisabledWrapToggle />
                </FileToolbar>
            )}
            {/* The webview stays in the tree while the source is up, so switching back keeps the page
                and whatever was scrolled or typed in it. */}
            {canPreview && (
                <div className={view === 'preview' ? 'relative flex min-h-0 grow flex-col bg-surface' : 'hidden'}>
                    {loading && <div className="progress-line absolute inset-x-0 top-0 z-10" role="progressbar" aria-label="Loading the page" />}
                    {error !== null && (
                        <EmptyState
                            className="absolute inset-0 z-10 bg-surface"
                            icon={<Icon icon={FileWarning} size={20} />}
                            action={
                                <Button variant="secondary" size="sm" onClick={retry}>
                                    Try again
                                </Button>
                            }
                        >
                            {name} did not load ({error})
                        </EmptyState>
                    )}
                    <div ref={host} className="flex min-h-0 grow" />
                </div>
            )}
        </div>
    );
}
