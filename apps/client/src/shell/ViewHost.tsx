import { Suspense, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isCanvasView, isDatabaseView, isFileView, type ProjectView } from '@ruimte/contracts';
import { isLooseView, type CellView } from '@/shell/cell-view';
import { FileViewer } from '@/shell/panels/FileViewer';
import { Canvas } from '@/canvas/Canvas';
import { newChatOn } from '@/project/new-chat';
import { ProjectStartScreen } from '@/shell/ProjectStartScreen';
import { SplitGrid } from '@/shell/SplitGrid';
import { useDiagram } from '@/state/diagram';
import { useDrawing } from '@/state/drawing';
import { BrowserFallback } from '@/nodes/BrowserBody';
import { usePage } from '@/nodes/use-page';
import { DeviceBody } from '@/devices/DeviceBody';
import { ChatBody } from '@/nodes/ChatBody';
import { TerminalBody } from '@/nodes/TerminalBody';
import { FileSurface } from '@/shell/panels/FileSurface';
import { useDocument } from '@/state/document';
import { isScratchProject, useProject } from '@/state/project';
import { useFiles } from '@/state/files';
import { ErrorBoundary, lazyNamed } from '@adecore/ui';

const DrawingView = lazyNamed(() => import('@/drawing/DrawingView'), 'DrawingView');
const DiagramView = lazyNamed(() => import('@/diagram/DiagramView'), 'DiagramView');
const DatabaseViewBody = lazyNamed(() => import('@/database/DatabaseViewBody'), 'DatabaseViewBody');

function StandaloneView({ view }: { view: ProjectView }) {
    // `bodyFocused` is one flag for the whole grid, so without the cell every chat and terminal would grab it.
    const focused = useDocument((s) => s.bodyFocused && s.activeViewId === view.id);
    return (
        <div
            className="absolute inset-0 bg-surface"
            // A press anywhere in the body is the way back in, the way clicking a node's body is.
            onPointerDownCapture={() => useDocument.getState().setBodyFocused(true)}
        >
            {/* A thread that runs the whole window is unreadable, so a chat of its own keeps a column
                of 768px of content, centered, with the surface filling what is left beside it. The
                scroller itself stays the width of the column, so its scrollbar sits at the column's
                own edge (`.chat-column` in `styles.css`). The type is the app's own: a thread reads
                the same here as it does in a node on the canvas. */}
            {view.kind === 'chat' && (
                <div className="chat-column flex h-full w-full flex-col">
                    <ChatBody id={view.id} focused={focused} />
                </div>
            )}
            {view.kind === 'terminal' && <TerminalBody id={view.id} focused={focused} />}
            {view.kind === 'browser' && <BrowserViewSurface id={view.id} />}
            {view.kind === 'device' && <DeviceBody id={view.id} />}
            {view.kind === 'drawing' && (
                <Suspense fallback={null}>
                    <DrawingView id={view.id} />
                </Suspense>
            )}
            {view.kind === 'diagram' && (
                <Suspense fallback={null}>
                    <DiagramView id={view.id} />
                </Suspense>
            )}
            {/* No column around it: prose centers itself at 768px inside its own renderer, and
                code wants every pixel the window has. */}
            {isFileView(view) && <FileSurface path={view.path} on="view" />}
        </div>
    );
}

/* A loose view keeps its file controls in the cell toolbar and its editor in the stable view host. */
function FilesSurface({ tabKey, ids }: { tabKey: string | null; ids: readonly string[] }) {
    const { t } = useTranslation('shell');
    /* Set by what was opened by hand, in the files panel, the git panel or the palette. */
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

/* The page of a browser view is the parked element, placed over this whole column by the layer. A
   view without an address has no page yet, so what is left under it is the splash. */
function BrowserViewSurface({ id }: { id: string }) {
    usePage(id);
    return <BrowserFallback id={id} className="h-full" />;
}

/* SplitView keeps this view mounted while tabs, pane positions and maximization change. */
export function ViewSurface({ view }: { view: CellView }) {
    const { t } = useTranslation('shell');
    const rev = useProject((s) => s.rev);
    const drawing = useDrawing((s) => s.elements);
    const diagram = useDiagram((s) => s.content);
    return (
        <ErrorBoundary key={view.id} label={t('viewHost.failed')} resetKeys={[view.id, rev, drawing, diagram]}>
            {isLooseView(view) ? (
                <FilesSurface tabKey={view.id} ids={[view.id]} />
            ) : isDatabaseView(view) ? (
                <div className="absolute inset-0 bg-surface" onPointerDownCapture={() => useDocument.getState().setBodyFocused(true)}>
                    <Suspense fallback={null}>
                        <DatabaseViewBody view={view} />
                    </Suspense>
                </div>
            ) : isCanvasView(view) ? (
                <Canvas />
            ) : (
                <StandaloneView view={view} />
            )}
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

/* The main column: the grid of cells of the open project. */
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
