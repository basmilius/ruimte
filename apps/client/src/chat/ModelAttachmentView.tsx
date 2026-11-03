import clsx from 'clsx';
import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Box, RotateCcw } from 'lucide-react';
import type { UiModelViewProps } from '@adecore/agents-react';
import { EmptyState, IconButton, ScrollArea, messageOf } from '@adecore/ui';
import { modelMimeOf } from '@/chat/model-attachment';
import { canDrawWebgl, ModelViewer } from '@/shell/panels/model-viewer';
import { useTheme } from '@/state/theme';

type Phase = { kind: 'waiting' } | { kind: 'loading' } | { kind: 'ready' } | { kind: 'failed'; reason: string } | { kind: 'no-webgl' };

const WAITING: Phase = { kind: 'waiting' };
const LOADING: Phase = { kind: 'loading' };
const NO_WEBGL: Phase = { kind: 'no-webgl' };

// A frame this far below the thread's edge starts loading, so a model scrolled into view is mostly there.
const LOAD_AHEAD = '300px';

/* Whether the element came near the screen once; a page without an observer counts it as there at once. */
function useSeenOnce(ref: React.RefObject<HTMLElement | null>): boolean {
    const [seen, setSeen] = useState(() => typeof IntersectionObserver === 'undefined');

    useEffect(() => {
        const element = ref.current;
        if (seen || element === null) {
            return;
        }
        const observer = new IntersectionObserver(
            (entries) => {
                if (entries.some((entry) => entry.isIntersecting)) {
                    setSeen(true);
                }
            },
            { rootMargin: LOAD_AHEAD }
        );
        observer.observe(element);
        return () => observer.disconnect();
    }, [ref, seen]);

    return seen;
}

/*
 * The 3D view of a Model block in a chat thread. The WebGL context is made only once the frame came near
 * the screen and the bytes are in, and goes back when the block leaves, so a long thread of models holds
 * no more contexts than it draws.
 */
export function ModelAttachmentView({ url, label }: UiModelViewProps) {
    const { t } = useTranslation(['chat', 'panels']);
    const frameRef = useRef<HTMLDivElement>(null);
    const hostRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<ModelViewer | null>(null);
    const seen = useSeenOnce(frameRef);
    const dark = useTheme((s) => s.resolved === 'dark');
    const [held, setHeld] = useState<{ url: string; phase: Phase } | null>(null);
    const webgl = canDrawWebgl();
    const phase: Phase = !webgl ? NO_WEBGL : !seen ? WAITING : held !== null && held.url === url ? held.phase : LOADING;
    const ready = phase.kind === 'ready';

    useEffect(() => {
        const host = hostRef.current;
        if (!seen || !webgl || host === null) {
            return;
        }
        const abort = new AbortController();
        let viewer: ModelViewer | null = null;
        void (async () => {
            try {
                const response = await fetch(url, { signal: abort.signal });
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}`);
                }
                const bytes = await response.arrayBuffer();
                const mime = modelMimeOf(new Uint8Array(bytes), response.headers.get('content-type') ?? '');
                if (mime === null) {
                    throw new Error(t('chat:modelView.notModel'));
                }
                if (abort.signal.aborted) {
                    return;
                }
                viewer = new ModelViewer(host);
                viewerRef.current = viewer;
                await viewer.load(bytes, mime, t('panels:file.model.nestedRoot'));
                if (!abort.signal.aborted) {
                    setHeld({ url, phase: { kind: 'ready' } });
                }
            } catch (e) {
                // Nothing left to draw, so the context goes back now rather than when the block leaves.
                viewer?.dispose();
                if (!abort.signal.aborted) {
                    setHeld({ url, phase: { kind: 'failed', reason: messageOf(e) } });
                }
            }
        })();
        return () => {
            abort.abort();
            viewer?.dispose();
            if (viewerRef.current === viewer) {
                viewerRef.current = null;
            }
        };
    }, [seen, webgl, url, t]);

    useEffect(() => {
        if (ready) {
            viewerRef.current?.setDark(dark);
        }
    }, [ready, dark]);

    useEffect(() => {
        const frame = frameRef.current;
        if (frame === null) {
            return;
        }
        // A plain wheel scrolls the thread past the model; a pinch (which arrives with ctrlKey) or Cmd zooms it.
        const passWheel = (event: WheelEvent) => {
            if (!event.ctrlKey && !event.metaKey) {
                event.stopPropagation();
            }
        };
        frame.addEventListener('wheel', passWheel, { capture: true });
        return () => frame.removeEventListener('wheel', passWheel, { capture: true });
    }, []);

    return (
        <div ref={frameRef} className="relative size-full">
            <div ref={hostRef} className={clsx('absolute inset-0', !ready && 'invisible')} />
            {ready && (
                <div className="absolute top-2 right-2">
                    <IconButton icon={RotateCcw} size="sm" label={t('panels:file.model.resetCamera')} onClick={() => viewerRef.current?.resetCamera()} />
                </div>
            )}
            {!ready && (
                <ScrollArea className="absolute inset-0" viewportClassName="grid place-items-center">
                    {phase.kind === 'failed' && (
                        <EmptyState className="select-text" icon={Box}>
                            {t('panels:file.model.failed', { name: label, reason: phase.reason })}
                        </EmptyState>
                    )}
                    {phase.kind === 'no-webgl' && (
                        <EmptyState className="select-text" icon={Box}>
                            {t('panels:file.model.noWebgl', { name: label })}
                        </EmptyState>
                    )}
                    {phase.kind === 'loading' && <EmptyState busy>{t('panels:file.reading', { name: label })}</EmptyState>}
                </ScrollArea>
            )}
        </div>
    );
}
