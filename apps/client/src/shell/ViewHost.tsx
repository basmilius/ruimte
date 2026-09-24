import { Suspense, useEffect, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { isCanvasView, isFileView, type ProjectView } from '@ruimte/contracts';
import { isFilesView, type CellView } from '@/shell/files-view';
import { FileViewer } from '@/shell/panels/FileViewer';
import { Canvas } from '@/canvas/Canvas';
import { ProjectStartScreen } from '@/shell/ProjectStartScreen';
import { SplitGrid } from '@/shell/SplitGrid';
import { useDiagram } from '@/state/diagram';
import { useDrawing } from '@/state/drawing';
import { BrowserFallback, usePage } from '@/nodes/BrowserBody';
import { DeviceBody } from '@/devices/DeviceBody';
import { ChatBody } from '@/nodes/ChatBody';
import { TerminalBody } from '@/nodes/TerminalBody';
import { FileSurface } from '@/shell/panels/FileSurface';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useFiles } from '@/state/files';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { lazyNamed } from '@/ui/lazy';

const DrawingView = lazyNamed(() => import('@/drawing/DrawingView'), 'DrawingView');
const DiagramView = lazyNamed(() => import('@/diagram/DiagramView'), 'DiagramView');

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

/*
 * The files of this client in their cell: the body under the tabs, which stand in the bar above.
 * It takes the keyboard the way a standalone view does, so the file that just opened answers to the
 * shortcuts the workspace binds for a files cell (`canvas/canvas-shortcuts.ts`).
 */
function FilesSurface() {
    const { t } = useTranslation('shell');
    const active = useFiles((s) => s.active);
    /* Counts what was opened by hand, in the files panel, the git panel or the palette. */
    const focusRequest = useFiles((s) => s.focusRequest);
    const bodyRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (focusRequest === 0) {
            return;
        }
        /* A frame later, not now: the palette that opened this file is still closing, and a dialog
           puts focus back where it found it on its way out. */
        const frame = requestAnimationFrame(() => bodyRef.current?.focus());
        return () => window.cancelAnimationFrame(frame);
    }, [focusRequest]);

    return (
        <div
            ref={bodyRef}
            tabIndex={-1}
            className="absolute inset-0 flex flex-col bg-surface outline-none"
            onPointerDownCapture={() => useDocument.getState().setBodyFocused(true)}
        >
            {/* The tabs stay in the bar above, so another file is one click away from a broken one. */}
            <ErrorBoundary label={t('filesView.failed')} resetKeys={[active]} className="flex min-h-0 grow flex-col">
                <FileViewer />
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

/*
 * One cell of the grid. A canvas view draws the canvas; every other kind draws the body of its one
 * node, without a frame. A cell draws what its view is and nothing else: the canvas used to stay
 * mounted under every other kind because it carried the app's shortcuts, and with up to nine cells that
 * would mean nine hidden canvases. The shortcuts moved to the workspace (`canvas/canvas-shortcuts.ts`).
 */
export function ViewSurface({ view }: { view: CellView }) {
    const { t } = useTranslation('shell');
    /* A view draws from the project document, and a drawing or a diagram from a file of its own as
       well. Reading an editor this cell has none of is the blank one, which never changes. */
    const rev = useProject((s) => s.rev);
    const drawing = useDrawing((s) => s.elements);
    const diagram = useDiagram((s) => s.content);
    if (isFilesView(view)) {
        return <FilesSurface />;
    }
    return (
        /* Inside the cell and around the view alone: the cell's toolbar and the dock stay usable,
           and the cells beside it never notice. */
        <ErrorBoundary label={t('viewHost.failed')} resetKeys={[view.id, rev, drawing, diagram]}>
            {isCanvasView(view) ? <Canvas /> : <StandaloneView view={view} />}
        </ErrorBoundary>
    );
}

/* The main column: the grid of cells of the open project. */
export function ViewHost() {
    const { t } = useTranslation('shell');
    /* The layout answers this, not the list of views: a project whose only cell holds the files has
       no view of its own and still has something on screen. */
    const empty = useDocument((s) => s.layout === null);
    const projectId = useProject((s) => s.current?.projectId);
    return empty ? (
        <ErrorBoundary label={t('projectStart.failed')} resetKeys={[projectId]}>
            <ProjectStartScreen />
        </ErrorBoundary>
    ) : (
        <SplitGrid />
    );
}
