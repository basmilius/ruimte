import { ButtonGroup, EmptyState, IconButton, messageOf, ScrollArea } from '@adecore/ui';
import { formatBytes, formatNumber } from '@adecore/ui/format';
import { BYTES_READ_MAX_BYTES, type FsReadBinary } from '@ruimte/contracts';
import clsx from 'clsx';
import { Box, Cuboid, Grid3x3, Pause, Play, RotateCcw, Spotlight } from 'lucide-react';
import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';
import { FileContextMenu, FileToolbar, FileToolbarToggle } from '@/files/FileToolbar';
import { RevealButton } from '@/files/RevealButton';
import { useTheme } from '@/state/theme';
import { FILE_FOOTER } from '@/surface/panels/classes';
import { readSourceBytes, revealablePath, useEndpointIdOf, type FileSource } from '@/surface/panels/file-source';
import { canDrawWebgl, ModelViewer, type LoadedModel } from '@/surface/panels/model-viewer';

type Phase = { kind: 'loading' } | { kind: 'ready'; model: LoadedModel } | { kind: 'failed'; reason: string } | { kind: 'no-webgl' };

const LOADING: Phase = { kind: 'loading' };
const NO_WEBGL: Phase = { kind: 'no-webgl' };

/* Hands a switch of the toolbar to the viewer once the model is in, and again whenever it flips. */
function useViewerSetting(
    viewer: RefObject<ModelViewer | null>,
    ready: boolean,
    setter: 'setWireframe' | 'setGrid' | 'setDark' | 'setStudioLight' | 'setPlaying',
    value: boolean
): void {
    useEffect(() => {
        if (ready) {
            viewer.current?.[setter](value);
        }
    }, [viewer, ready, setter, value]);
}

/* A binary glTF, a USDZ package or an STL, drawn in 3D on the same plain surface as an image. */
export function ModelFile({ source, name, read }: { source: FileSource; name: string; read: FsReadBinary }) {
    const { t } = useTranslation('panels');
    const endpointId = useEndpointIdOf(source);
    const hostRef = useRef<HTMLDivElement>(null);
    const viewerRef = useRef<ModelViewer | null>(null);
    // As a string, so the read does not start again for every new object that says the same.
    const locator = JSON.stringify({ source, version: { mtime: read.mtime, size: read.size } });
    const key = JSON.stringify([endpointId, locator]);
    const path = revealablePath(source);
    const [held, setHeld] = useState<{ key: string; phase: Phase } | null>(null);
    const dark = useTheme((s) => s.resolved === 'dark');
    const [grid, setGrid] = useState(true);
    const [studioLight, setStudioLight] = useState(false);
    const [wireframe, setWireframe] = useState(false);
    const [playing, setPlaying] = useState(false);
    const phase = !canDrawWebgl() ? NO_WEBGL : held !== null && held.key === key ? held.phase : LOADING;
    const ready = phase.kind === 'ready';

    useEffect(() => {
        const host = hostRef.current;
        if (host === null || !canDrawWebgl()) {
            return;
        }
        let cancelled = false;
        // Made once the bytes are in, so a slow machine does not hold a context for a canvas nobody sees yet.
        let viewer: ModelViewer | null = null;
        const located = JSON.parse(locator) as { source: FileSource; version: { mtime: number; size: number } };
        readSourceBytes(endpointId, located.source, located.version, BYTES_READ_MAX_BYTES)
            .then((bytes) => {
                if (cancelled) {
                    return null;
                }
                viewer = new ModelViewer(host);
                viewerRef.current = viewer;
                return viewer.load(bytes, read.mime, t('file.model.nestedRoot'));
            })
            .then(
                (model) => {
                    if (model !== null && !cancelled) {
                        setHeld({ key, phase: { kind: 'ready', model } });
                    }
                },
                (e: unknown) => {
                    // Nothing left to draw, so the context goes back now rather than when the tab closes.
                    viewer?.dispose();
                    if (!cancelled) {
                        setHeld({ key, phase: { kind: 'failed', reason: messageOf(e) } });
                    }
                }
            );
        return () => {
            cancelled = true;
            viewer?.dispose();
            if (viewerRef.current === viewer) {
                viewerRef.current = null;
            }
        };
    }, [key, endpointId, locator, read.mime, t]);

    useViewerSetting(viewerRef, ready, 'setWireframe', wireframe);
    useViewerSetting(viewerRef, ready, 'setGrid', grid);
    useViewerSetting(viewerRef, ready, 'setDark', dark);
    useViewerSetting(viewerRef, ready, 'setStudioLight', studioLight);
    useViewerSetting(viewerRef, ready, 'setPlaying', playing);

    const overlay = (): ReactNode => {
        if (phase.kind === 'loading') {
            return <EmptyState busy>{t('file.reading', { name })}</EmptyState>;
        }
        if (phase.kind === 'ready') {
            return null;
        }
        return (
            <EmptyState className="select-text" icon={Box} action={path === null ? undefined : <RevealButton path={path} />}>
                {phase.kind === 'failed' ? t('file.model.failed', { name, reason: phase.reason }) : t('file.model.noWebgl', { name })}
            </EmptyState>
        );
    };

    return (
        <div className="flex min-h-0 min-w-0 grow flex-col">
            {phase.kind === 'ready' ? (
                <FileToolbar>
                    <ButtonGroup>
                        <IconButton icon={RotateCcw} size="sm" label={t('file.model.resetCamera')} onClick={() => viewerRef.current?.resetCamera()} />
                        <FileToolbarToggle icon={Grid3x3} label={t('file.model.grid')} active={grid} onClick={() => setGrid(!grid)} />
                        <FileToolbarToggle
                            icon={Spotlight}
                            label={t('file.model.studioLight')}
                            active={studioLight}
                            onClick={() => setStudioLight(!studioLight)}
                        />
                        <FileToolbarToggle icon={Cuboid} label={t('file.model.wireframe')} active={wireframe} onClick={() => setWireframe(!wireframe)} />
                        {phase.model.animated && (
                            <IconButton
                                icon={playing ? Pause : Play}
                                size="sm"
                                label={playing ? t('file.model.pause') : t('file.model.play')}
                                onClick={() => setPlaying(!playing)}
                            />
                        )}
                    </ButtonGroup>
                </FileToolbar>
            ) : (
                <FileToolbar />
            )}
            <FileContextMenu className="relative min-h-0 grow overflow-hidden bg-surface-sunken">
                <div ref={hostRef} className={clsx('absolute inset-0', !ready && 'invisible')} />
                {!ready && (
                    <ScrollArea className="absolute inset-0" viewportClassName="grid place-items-center p-4">
                        {overlay()}
                    </ScrollArea>
                )}
            </FileContextMenu>
            <div className={FILE_FOOTER}>
                {phase.kind === 'ready' && (
                    <>
                        <span>{t('file.model.vertices', { count: phase.model.vertices, value: formatNumber(phase.model.vertices) })}</span>
                        <span>{t('file.model.triangles', { count: phase.model.triangles, value: formatNumber(phase.model.triangles) })}</span>
                    </>
                )}
                <span>{formatBytes(read.size)}</span>
                <span>{read.mime}</span>
            </div>
        </div>
    );
}
