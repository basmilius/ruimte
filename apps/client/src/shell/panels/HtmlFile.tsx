import { useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Code, Eye, FileWarning } from 'lucide-react';
import type { FsReadText } from '@ruimte/contracts';
import { focusCellOfView, watchGuestFocus } from '@/browser/guest-focus';
import { registerPreviewGuest } from '@/browser/preview-guests';
import { isDesktop } from '@/desktop/bridge';
import { FindBar } from '@/find/FindBar';
import { useFind } from '@/find/use-find';
import { CodeFile } from '@/shell/panels/CodeFile';
import { FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { localFileUrl } from '@/shell/panels/file-url';
import { dirnameOf } from '@/shell/panels/files-tree';
import { htmlPreviewDocument } from '@/shell/panels/html-preview';
import { trackPageReady, usePreviewFind, type FindablePage, type FoundInPage } from '@/shell/panels/use-preview-find';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { useUnsaved } from '@/state/text-drafts';
import { CellViewContext } from '@/state/workspace-stores';
import { useTransport } from '@/transport/context';
import { Button } from '@/ui/Button';
import { BTN_GROUP } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';

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

interface PreviewWebview extends FindablePage {
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
    const { t } = useTranslation('panels');
    const onThisMachine = useEndpoints((state) => state.endpoints.find((endpoint) => endpoint.id === state.activeId)?.reachability === 'loopback');
    const nativePreview = isDesktop() && onThisMachine;
    const [chosen, setView] = useState<HtmlView>('preview');
    // The preview draws what is on disk, so a file with unsaved changes stays in the editor until they are saved.
    const unsaved = useUnsaved(useEndpointId(), path);
    const view = unsaved ? 'source' : chosen;
    const [loading, setLoading] = useState(nativePreview);
    const [error, setError] = useState<string | null>(null);
    const transport = useTransport();
    const host = useRef<HTMLDivElement>(null);
    const page = useRef<PreviewWebview | null>(null);
    const cell = useContext(CellViewContext);
    const url = localFileUrl(path);
    const staticDocument = useMemo(() => staticPreviewDocument(read.text), [read.text]);
    const surface = useRef<HTMLDivElement>(null);
    // The source is the editor's to search.
    const find = useFind(surface, view === 'preview');
    const pageFind = usePreviewFind(find, page);
    const { found, refresh } = pageFind;
    // The inert iframe is another origin, whose text the client cannot read.
    const findUnavailable = nativePreview ? null : isDesktop() ? t('file.html.findLocalOnly') : t('file.html.findDesktopOnly');

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
            refresh();
        });
        trackPageReady(element);
        element.addEventListener('found-in-page', (event) => found((event as unknown as { result: FoundInPage }).result));
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
        const offMenu = registerPreviewGuest(element);
        return () => {
            offFocus?.();
            offMenu();
            page.current = null;
            element.remove();
        };
    }, [nativePreview, url, path, cell, found, refresh]);

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
            <FileToolbarToggle
                icon={Eye}
                label={unsaved ? t('file.view.previewAfterSave') : t('file.view.preview')}
                active={view === 'preview'}
                disabled={unsaved}
                onClick={() => setView('preview')}
            />
            <FileToolbarToggle icon={Code} label={t('file.view.source')} active={view === 'source'} onClick={() => setView('source')} />
        </div>
    );

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {view === 'source' ? <CodeFile path={path} read={read} toolbarExtra={controls} /> : <FileToolbar>{controls}</FileToolbar>}
            <div ref={surface} className={view === 'preview' ? 'relative flex min-h-0 grow flex-col bg-surface' : 'hidden'}>
                {find.open && (
                    <FindBar
                        find={find}
                        total={pageFind.total}
                        current={pageFind.current}
                        onStep={pageFind.step}
                        unsupported={{ wholeWord: t('file.html.findTextOnly'), regex: t('file.html.findTextOnly') }}
                        disabledReason={findUnavailable}
                    />
                )}
                {nativePreview ? (
                    <>
                        {loading && <div className="progress-line absolute inset-x-0 top-0 z-10" role="progressbar" aria-label={t('file.html.loading')} />}
                        {error !== null && (
                            <EmptyState
                                className="absolute inset-0 z-10 bg-surface"
                                icon={FileWarning}
                                action={
                                    <Button variant="secondary" size="sm" onClick={retry}>
                                        {t('common:action.retry')}
                                    </Button>
                                }
                            >
                                {t('file.html.failed', { name, error })}
                            </EmptyState>
                        )}
                        <div ref={host} className="flex min-h-0 grow" />
                    </>
                ) : (
                    <iframe
                        title={t('file.html.previewTitle', { name })}
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
