import { ErrorBoundary } from '@adecore/ui';
import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import { Fragment, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Canvas } from '@/canvas/Canvas';
import { FileViewer } from '@/files/FileViewer';
import { newChatOn } from '@/project/new-chat';
import { viewKindRegistry } from '@/registry/view-kinds';
import { ProjectStartScreen } from '@/shell/ProjectStartScreen';
import { SplitGrid } from '@/shell/SplitGrid';
import { useDiagram } from '@/state/diagram';
import { useDocument } from '@/state/document';
import { useDrawing } from '@/state/drawing';
import { useFiles } from '@/state/files';
import { isScratchProject, useProject } from '@/state/project';
import { isLooseView, type CellView } from '@/surface/cell-view';

function StandaloneView({ view }: { view: ProjectView }) {
    const kinds = viewKindRegistry.useAll();
    // `bodyFocused` is one flag for the whole grid, so without the cell every chat and terminal would grab it.
    const focused = useDocument((s) => s.bodyFocused && s.activeViewId === view.id);
    return (
        <div
            className="absolute inset-0 bg-surface"
            // A press anywhere in the body is the way back in, the way clicking a node's body is.
            onPointerDownCapture={() => useDocument.getState().setBodyFocused(true)}
        >
            {kinds.map((kind) => (
                <Fragment key={kind.id}>{kind.render(view, focused)}</Fragment>
            ))}
        </div>
    );
}

/* A loose view keeps its file controls in the cell toolbar and its editor in the stable view host. */
function FilesSurface({ tabKey, ids }: { tabKey: string | null; ids: readonly string[] }) {
    const { t } = useTranslation('shell');
    const focusRequest = useFiles((s) => s.focusRequest);
    const handled = useRef<number | null>(null);
    const bodyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (tabKey === null || focusRequest === null || focusRequest.key !== tabKey || handled.current === focusRequest.nonce) {
            return;
        }
        handled.current = focusRequest.nonce;
        /* A frame later, not now: the palette that opened this file is still closing, and a dialog
           puts focus back where it found it on its way out. */
        const frame = requestAnimationFrame(() => bodyRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [focusRequest, tabKey]);

    return (
        <div
            ref={bodyRef}
            tabIndex={-1}
            className={`absolute inset-0 flex flex-col bg-surface outline-none ${tabKey === null ? 'invisible' : ''}`}
            inert={tabKey === null}
            onPointerDownCapture={() => useDocument.getState().setBodyFocused(true)}
        >
            {/* The tabs stay in the bar above, so another file is one click away from a broken one. */}
            <ErrorBoundary label={t('filesView.failed')} resetKeys={[tabKey]} className="flex min-h-0 grow flex-col">
                <FileViewer active={tabKey} ids={ids} />
            </ErrorBoundary>
        </div>
    );
}

/* SplitView keeps this view mounted while tabs, pane positions and maximization change. */
export function ViewSurface({ view }: { view: CellView }) {
    const { t } = useTranslation('shell');
    const rev = useProject((s) => s.rev);
    const drawing = useDrawing((s) => s.elements);
    const diagram = useDiagram((s) => s.content);
    return (
        <ErrorBoundary key={view.id} label={t('viewHost.failed')} resetKeys={[view.id, rev, drawing, diagram]}>
            {isLooseView(view) ? <FilesSurface tabKey={view.id} ids={[view.id]} /> : isCanvasView(view) ? <Canvas /> : <StandaloneView view={view} />}
        </ErrorBoundary>
    );
}

/*
 * The Chats project starts its first chat automatically. A deliberately closed layout must leave
 * the start screen instead of reopening a chat immediately.
 */
function ChatsStart() {
    const endpointId = useProject((s) => s.currentEndpointId);
    const asked = useRef(false);
    const [failed, setFailed] = useState(false);

    useEffect(() => {
        if (endpointId === null || asked.current) {
            return;
        }
        asked.current = true;
        void newChatOn(endpointId).then((shown) => setFailed(!shown));
    }, [endpointId]);

    return failed ? <ProjectStartScreen /> : <div className="absolute inset-0 bg-surface" />;
}

export function ViewHost() {
    const { t } = useTranslation('shell');
    /* The layout answers this, not the list of views: a project whose only cell holds the files has
       no view of its own and still has something on screen. */
    const empty = useDocument((s) => s.layout === null);
    const projectId = useProject((s) => s.current?.projectId);
    const scratch = useProject((s) => isScratchProject(s.current));
    const closed = useDocument((s) => s.emptyLayout);
    return empty ? (
        <ErrorBoundary label={t('projectStart.failed')} resetKeys={[projectId]}>
            {scratch && !closed ? <ChatsStart key={projectId} /> : <ProjectStartScreen />}
        </ErrorBoundary>
    ) : (
        <SplitGrid />
    );
}
