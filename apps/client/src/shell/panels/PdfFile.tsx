import { revealFile } from './reveal-file';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CornerUpRight, FileText, Maximize, Scan } from 'lucide-react';
import { getDocument, GlobalWorkerOptions, TextLayer, version, type PDFDocumentProxy, type PDFPageProxy } from 'pdfjs-dist';
import workerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { FsReadBinary } from '@ruimte/contracts';
import { useEndpoints } from '@/state/endpoints';
import { useEndpointId } from '@/state/keys';
import { fileManagerName, useServer } from '@/state/server';
import { readResource } from '@/transport/byte-transfer';
import { bytesWorkerReady } from '@/transport/bytes-worker-host';
import { useTransport } from '@/transport/context';
import { useMachineUrl } from '@/transport/machine-url';
import { readPiece } from '@/transport/piece';
import { FileTextMenu, FileToolbar, FileToolbarToggle } from '@/shell/panels/FileToolbar';
import { PDF_PAGE_GAP, pdfPageBox, pdfPageScale, pdfPageTops, pdfReadingPage, type PdfPageSize, type PdfZoom } from '@/shell/panels/pdf-layout';
import { Button, ButtonGroup, EmptyState, Icon } from '@adecore/ui';
import { formatBytes, formatNumber } from '@adecore/ui/format';

// From this page's own origin, so the worker stays inside `worker-src 'self'`.
GlobalWorkerOptions.workerSrc = workerUrl;

// Where `pdfjsAssets` in `vite.config.ts` puts what pdf.js fetches by name.
function assetFolder(folder: string): string {
    return new URL(`${import.meta.env.BASE_URL}assets/pdfjs-${version}/${folder}/`, location.href).href;
}

// How far past the edge of the view a page is drawn ahead of being scrolled to.
const DRAW_AHEAD = '50% 0px';

type Source = { kind: 'url'; url: string } | { kind: 'data'; data: ArrayBuffer } | { kind: 'failed'; reason: string };

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}

/*
 * Where pdf.js reads the file. It fetches, and `connect-src` lets a fetch reach this page's origin
 * and http(s) but never a blob URL. So the ranges come from the daemon's route over a socket, or
 * from the bytes worker over a direct connection. A machine on another origin (the route sends no
 * CORS headers) and a direct connection the worker does not serve yet read the file whole over the
 * connection instead, as a blob would have been.
 */
function usePdfSource(path: string, read: FsReadBinary): Source | null {
    const transport = useTransport();
    const endpointId = useEndpointId();
    const direct = useEndpoints((s) => s.endpoints.find((entry) => entry.id === endpointId)?.direct === true);
    // Once per mount, the way `useMachineUrl` decides it, so the two never disagree.
    const [streamed] = useState(bytesWorkerReady);
    const blobOnly = direct && !streamed;
    const machine = useMachineUrl(blobOnly ? null : { kind: 'media', path, mtime: read.mtime, size: read.size }, endpointId);
    const url = machine.url !== null && new URL(machine.url, location.href).origin === location.origin ? machine.url : null;
    const whole = blobOnly || (machine.url !== null && url === null);
    const [held, setHeld] = useState<{ key: string; source: Source } | null>(null);
    const key = `${endpointId}\n${path}\n${read.mtime}\n${read.size}`;

    useEffect(() => {
        if (!whole) {
            return;
        }
        let cancelled = false;
        readResource((piece) => readPiece(transport, piece), { kind: 'file', path })
            .then((blob) => blob.arrayBuffer())
            .then(
                (data) => !cancelled && setHeld({ key, source: { kind: 'data', data } }),
                (e: unknown) => !cancelled && setHeld({ key, source: { kind: 'failed', reason: messageOf(e) } })
            );
        return () => {
            cancelled = true;
        };
    }, [whole, transport, path, key]);

    // One object per source, since opening the document hangs on its identity.
    return useMemo((): Source | null => {
        if (machine.failure !== null) {
            return { kind: 'failed', reason: machine.failure };
        }
        if (url !== null) {
            return { kind: 'url', url };
        }
        return held !== null && held.key === key ? held.source : null;
    }, [machine.failure, url, held, key]);
}

/*
 * A PDF drawn by pdf.js: its pages stacked on canvases, only those near the view drawn, each with a
 * layer of its text so it can be selected and copied. pdf.js reads the file in ranges, so a long
 * document opens at its first page without the rest.
 */
export function PdfFile({ path, name, read }: { path: string; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const platform = useServer((s) => s.platform);
    const transport = useTransport();
    const source = usePdfSource(path, read);
    const [zoom, setZoom] = useState<PdfZoom>('fit');
    const [opened, setOpened] = useState<{ source: Source; doc: PDFDocumentProxy; first: PdfPageSize } | null>(null);
    const [failure, setFailure] = useState<{ source: Source; reason: string } | null>(null);
    const [sizes, setSizes] = useState<ReadonlyMap<number, PdfPageSize>>(new Map());
    const [available, setAvailable] = useState(0);
    const [scroll, setScroll] = useState({ top: 0, height: 0, scrollHeight: 0 });
    const [scroller, setScroller] = useState<HTMLDivElement | null>(null);

    const doc = opened !== null && opened.source === source ? opened.doc : null;
    const count = doc?.numPages ?? 0;
    const scales = useMemo(
        () => Array.from({ length: count }, (_, i) => pdfPageScale(zoom, sizes.get(i) ?? opened?.first ?? { width: 0, height: 0 }, available)),
        [count, zoom, sizes, opened, available]
    );
    const boxes = useMemo(() => scales.map((scale, i) => pdfPageBox(sizes.get(i) ?? opened?.first ?? { width: 0, height: 0 }, scale)), [scales, sizes, opened]);
    const tops = useMemo(() => pdfPageTops(boxes.map((box) => box.height)), [boxes]);
    const page = pdfReadingPage(tops, scroll);

    useEffect(() => {
        if (source === null || source.kind === 'failed') {
            return;
        }
        // pdf.js hands the bytes to its worker, so a copy keeps them for a second open of the same source.
        const task = getDocument({
            ...(source.kind === 'url' ? { url: source.url } : { data: source.data.slice(0) }),
            wasmUrl: assetFolder('wasm'),
            standardFontDataUrl: assetFolder('standard_fonts'),
            cMapUrl: assetFolder('cmaps'),
            iccUrl: assetFolder('iccs'),
            // Ranges only, and only the ones a drawn page asks for: a long document never loads whole.
            disableStream: true,
            disableAutoFetch: true
        });
        task.promise
            .then(async (loaded) => {
                const viewport = (await loaded.getPage(1)).getViewport({ scale: 1 });
                setSizes(new Map());
                setOpened({ source, doc: loaded, first: { width: viewport.width, height: viewport.height } });
            })
            .catch((e: unknown) => {
                if (e instanceof Error && e.name === 'PasswordException') {
                    setFailure({ source, reason: t('file.pdf.password') });
                    return;
                }
                setFailure({ source, reason: messageOf(e) });
            });
        return () => {
            void task.destroy();
        };
    }, [source, t]);

    useEffect(() => {
        if (scroller === null) {
            return;
        }
        const measure = (): void => {
            setAvailable(Math.max(0, scroller.clientWidth - 2 * PDF_PAGE_GAP));
            setScroll({ top: scroller.scrollTop, height: scroller.clientHeight, scrollHeight: scroller.scrollHeight });
        };
        measure();
        const observer = new ResizeObserver(measure);
        observer.observe(scroller);
        let frame = 0;
        const onScroll = (): void => {
            cancelAnimationFrame(frame);
            frame = requestAnimationFrame(measure);
        };
        scroller.addEventListener('scroll', onScroll, { passive: true });
        return () => {
            observer.disconnect();
            cancelAnimationFrame(frame);
            scroller.removeEventListener('scroll', onScroll);
        };
    }, [scroller]);

    const learnSize = useCallback((index: number, size: PdfPageSize): void => {
        setSizes((current) => {
            const known = current.get(index);
            if (known && known.width === size.width && known.height === size.height) {
                return current;
            }
            return new Map(current).set(index, size);
        });
    }, []);

    const reveal = (): void => {
        revealFile(transport, path);
    };

    // The page that was being read stays at the top when the zoom changes under it.
    const changeZoom = (next: PdfZoom): void => {
        if (next === zoom) {
            return;
        }
        const keep = page;
        setZoom(next);
        requestAnimationFrame(() => {
            const target = scroller?.querySelector<HTMLElement>(`[data-page="${keep}"]`);
            if (scroller && target) {
                scroller.scrollTop = target.offsetTop - PDF_PAGE_GAP;
            }
        });
    };

    const failed = source?.kind === 'failed' ? source.reason : failure !== null && failure.source === source ? failure.reason : null;

    const body = (): React.ReactNode => {
        if (failed !== null) {
            return (
                <EmptyState
                    className="m-auto select-text"
                    icon={FileText}
                    action={
                        <Button variant="secondary" size="sm" onClick={reveal}>
                            <Icon icon={CornerUpRight} size={14} /> {t('file.revealIn', { app: fileManagerName(platform) })}
                        </Button>
                    }
                >
                    {t('file.pdf.failed', { name, reason: failed })}
                </EmptyState>
            );
        }
        if (doc === null) {
            return (
                <EmptyState busy className="m-auto">
                    {t('file.reading', { name })}
                </EmptyState>
            );
        }
        return (
            <div className="relative flex w-max min-w-full flex-col items-center" style={{ gap: PDF_PAGE_GAP, padding: PDF_PAGE_GAP }}>
                {boxes.map((box, i) => (
                    <PdfPage key={i} doc={doc} index={i} box={box} scale={scales[i] ?? 1} root={scroller} onSize={learnSize} />
                ))}
            </div>
        );
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            <FileToolbar>
                <ButtonGroup>
                    <FileToolbarToggle icon={Maximize} label={t('file.image.fit')} active={zoom === 'fit'} onClick={() => changeZoom('fit')} />
                    <FileToolbarToggle icon={Scan} label={t('file.image.actual')} active={zoom === 'full'} onClick={() => changeZoom('full')} />
                </ButtonGroup>
            </FileToolbar>
            <FileTextMenu className="flex min-h-0 grow flex-col">
                <div ref={setScroller} tabIndex={-1} className="flex min-h-0 grow flex-col overflow-auto bg-surface-sunken outline-none select-text">
                    {body()}
                </div>
            </FileTextMenu>
            <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border px-2 text-xs text-text-muted select-text">
                {count > 0 && <span>{t('file.pdf.page', { page: formatNumber(Math.max(page, 1)), total: formatNumber(count) })}</span>}
                <span>{formatBytes(read.size)}</span>
                <span>{read.mime}</span>
            </div>
        </div>
    );
}

interface PdfPageProps {
    doc: PDFDocumentProxy;
    index: number;
    box: PdfPageSize;
    scale: number;
    root: HTMLDivElement | null;
    onSize(index: number, size: PdfPageSize): void;
}

/* One page: a box of its size always, its canvas and its text only while it is near the view. */
function PdfPage({ doc, index, box, scale, root, onSize }: PdfPageProps) {
    const frame = useRef<HTMLDivElement>(null);
    const canvas = useRef<HTMLCanvasElement>(null);
    const text = useRef<HTMLDivElement>(null);
    const [near, setNear] = useState(false);
    const [page, setPage] = useState<PDFPageProxy | null>(null);

    useEffect(() => {
        const target = frame.current;
        if (root === null || target === null) {
            return;
        }
        const observer = new IntersectionObserver(([entry]) => setNear(entry?.isIntersecting === true), { root, rootMargin: DRAW_AHEAD });
        observer.observe(target);
        return () => observer.disconnect();
    }, [root]);

    useEffect(() => {
        if (!near) {
            return;
        }
        let cancelled = false;
        let loaded: PDFPageProxy | null = null;
        doc.getPage(index + 1).then(
            (proxy) => {
                if (cancelled) {
                    return;
                }
                loaded = proxy;
                const viewport = proxy.getViewport({ scale: 1 });
                onSize(index, { width: viewport.width, height: viewport.height });
                setPage(proxy);
            },
            // A document torn down while the page was on its way; the document's own failure is shown above.
            () => undefined
        );
        return () => {
            cancelled = true;
            setPage(null);
            loaded?.cleanup();
        };
    }, [near, doc, index, onSize]);

    useEffect(() => {
        const target = canvas.current;
        const layer = text.current;
        if (page === null || target === null || layer === null) {
            return;
        }
        const viewport = page.getViewport({ scale });
        const ratio = window.devicePixelRatio || 1;
        target.width = Math.floor(box.width * ratio);
        target.height = Math.floor(box.height * ratio);
        const drawing = page.render({ canvas: target, viewport, transform: ratio === 1 ? undefined : [ratio, 0, 0, ratio, 0, 0] });
        drawing.promise.catch(() => undefined);

        layer.replaceChildren();
        layer.style.setProperty('--total-scale-factor', String(scale * page.userUnit));
        const textLayer = new TextLayer({ textContentSource: page.streamTextContent(), container: layer, viewport });
        textLayer.render().catch(() => undefined);
        return () => {
            drawing.cancel();
            textLayer.cancel();
        };
    }, [page, scale, box.width, box.height]);

    return (
        <div
            ref={frame}
            data-page={index + 1}
            className="relative shrink-0 overflow-hidden bg-surface ring-1 ring-border"
            style={{ width: box.width, height: box.height }}
        >
            {page !== null && (
                <>
                    <canvas ref={canvas} className="absolute inset-0 size-full" />
                    <div ref={text} className="pdf-text-layer" />
                </>
            )}
        </div>
    );
}
