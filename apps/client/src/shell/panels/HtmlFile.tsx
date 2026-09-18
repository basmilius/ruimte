import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Code, Eye, FileWarning } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { focusCellOfView, watchGuestFocus } from '@/browser/guest-focus';
import { isDesktop } from '@/desktop/bridge';
import { CodeFile } from '@/shell/panels/CodeFile';
import { DisabledWrapToggle, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { localFileUrl } from '@/shell/panels/file-url';
import { dirnameOf } from '@/shell/panels/files-tree';
import { htmlPreviewDocument } from '@/shell/panels/html-preview';
import { useEndpoints } from '@/state/endpoints';
import { CellViewContext } from '@/state/workspace-stores';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { BTN_GROUP } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';

type HtmlView = 'preview' | 'source';

const PREVIEW_PARTITION = 'preview';
const ABORTED = -3;
const SCROLL_MESSAGE = 'ruimte:preview-scroll:';
const scrollPositions = new Map<string, { x: number; y: number }>();

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

const describeFailure = (description: string): string => description.replace(/^ERR_/, '').replaceAll('_', ' ').toLowerCase();

/* Scripts cannot satisfy the parent app's CSP in `srcDoc`; the sandbox remains the security boundary if this cleanup misses malformed markup. */
const staticPreviewDocument = (html: string): string => {
    const parsed = new DOMParser().parseFromString(html, 'text/html');
    parsed.querySelectorAll('script, meta[http-equiv="refresh" i]').forEach((element) => element.remove());
    for (const element of parsed.querySelectorAll('*')) {
        for (const attribute of [...element.attributes]) {
            if (
                /^on/i.test(attribute.name) ||
                (/^(?:href|src|xlink:href|action|formaction)$/i.test(attribute.name) && /^\s*(?:javascript|vbscript):/i.test(attribute.value))
            ) {
                element.removeAttribute(attribute.name);
            }
        }
    }
    return htmlPreviewDocument(`<!doctype html>${parsed.documentElement.outerHTML}`);
};

/* Native clients keep the full file-backed webview; other clients preview the text they already received in an inert iframe. */
export function HtmlFile({ path, name, read }: { path: string; name: string; read: FsReadText }) {
    const onThisMachine = useEndpoints((state) => state.endpoints.find((endpoint) => endpoint.id === state.activeId)?.reachability === 'loopback');
    const nativePreview = isDesktop() && onThisMachine;
    const [view, setView] = useState<HtmlView>('preview');
    const [loading, setLoading] = useState(nativePreview);
    const [error, setError] = useState<string | null>(null);
    const transport = useTransport();
    const host = useRef<HTMLDivElement>(null);
    const page = useRef<PreviewWebview | null>(null);
    const cell = useContext(CellViewContext);
    const url = localFileUrl(path);
    const staticDocument = useMemo(() => staticPreviewDocument(read.text), [read.text]);

    useEffect(() => {
        const parent = host.current;
        if (!nativePreview || !parent) {
            return;
        }
        const element = document.createElement('webview') as PreviewWebview;
        element.setAttribute('partition', PREVIEW_PARTITION);
        element.setAttribute('webpreferences', 'sandbox=yes,contextIsolation=yes');
        element.setAttribute('allowpopups', '');
        element.className = 'file-preview-page file-preview-webview';
        element.addEventListener('did-start-loading', () => {
            setLoading(true);
            setError(null);
        });
        element.addEventListener('did-stop-loading', () => {
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
    }, [nativePreview, url, path, cell]);

    useEffect(() => {
        if (!nativePreview) {
            return;
        }
        const folder = dirnameOf(path);
        return transport.on('fs.changed', (payload) => {
            if (payload.paths.some((changed) => changed === folder || changed.startsWith(`${folder}/`))) {
                page.current?.reload();
            }
        });
    }, [transport, nativePreview, path]);

    const retry = useCallback(() => {
        setError(null);
        page.current?.reload();
    }, []);

    const controls = (
        <div className={BTN_GROUP}>
            <FileToolbarToggle icon={Eye} label="Preview" active={view === 'preview'} onClick={() => setView('preview')} />
            <FileToolbarToggle icon={Code} label="Source" active={view === 'source'} onClick={() => setView('source')} />
        </div>
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
            <div className={view === 'preview' ? 'relative flex min-h-0 grow flex-col bg-surface' : 'hidden'}>
                {nativePreview ? (
                    <>
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
                    </>
                ) : (
                    <iframe
                        title={`${name} preview`}
                        className="file-preview-page min-h-0 grow bg-white"
                        sandbox=""
                        srcDoc={staticDocument}
                        onFocus={() => {
                            if (cell !== null) {
                                focusCellOfView(cell);
                            }
                        }}
                    />
                )}
            </div>
        </div>
    );
}
