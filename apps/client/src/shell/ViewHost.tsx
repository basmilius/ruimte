import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { isCanvasView, isFileView, isOpenableView, type ProjectView } from '@ruimte/contracts';
import { Canvas } from '@/canvas/Canvas';
import { ProjectStartScreen } from '@/shell/ProjectStartScreen';
import { SplitGrid } from '@/shell/SplitGrid';
import { DiagramView } from '@/diagram/DiagramView';
import { DrawingView } from '@/drawing/DrawingView';
import { useDiagram } from '@/state/diagram';
import { drawingHasSomethingToClear, useDrawing, useDrawingStore } from '@/state/drawing';
import { BrowserFallback, usePage } from '@/nodes/BrowserBody';
import { DeviceBody } from '@/devices/DeviceBody';
import { ChatBody } from '@/nodes/ChatBody';
import { TerminalBody } from '@/nodes/TerminalBody';
import { FileSurface } from '@/shell/panels/FileSurface';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { isApplePlatform } from '@/desktop/bridge';
import { isLeaveNodeShortcut } from '@/terminal/keymap';
import { focusViewRow } from '@/shell/sidebar-focus';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { isInFloatingLayer } from '@/ui/floating';

/*
 * A view of its own has no canvas to fall back to, so leaving its body puts the keyboard on its row
 * in the sidebar. A chat leaves on Escape; a terminal hands Escape to the program it runs and leaves
 * on the same shortcut a terminal node uses.
 */
const useLeaveOnEscape = (view: ProjectView): void => {
    const drawingStore = useDrawingStore();
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            const leaving = view.kind === 'terminal' ? isLeaveNodeShortcut(e, isApplePlatform()) : e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey;
            // An open popup or dialog owns Escape; it closes itself and the body keeps the keyboard.
            // Every cell has this listener, so only the one the keyboard is in may answer.
            if (!leaving || !useDocument.getState().bodyFocused || useDocument.getState().activeViewId !== view.id || isInFloatingLayer(e.target)) {
                return;
            }
            // A drawing clears its draft, its selection and its tool first; only an empty one is left.
            if (view.kind === 'drawing' && drawingHasSomethingToClear(drawingStore.getState())) {
                return;
            }
            e.preventDefault();
            useDocument.getState().setBodyFocused(false);
            focusViewRow(view.id);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [drawingStore, view.id, view.kind]);
};

function StandaloneView({ view }: { view: ProjectView }) {
    // `bodyFocused` is one flag for the whole grid, so without the cell every chat and terminal would grab it.
    const focused = useDocument((s) => s.bodyFocused && s.activeViewId === view.id);
    useLeaveOnEscape(view);
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
            {view.kind === 'drawing' && <DrawingView id={view.id} />}
            {view.kind === 'diagram' && <DiagramView id={view.id} />}
            {/* No column around it: prose centers itself at 768px inside its own renderer, and
                code wants every pixel the window has. */}
            {isFileView(view) && <FileSurface path={view.path} on="view" />}
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
export function ViewSurface({ view }: { view: ProjectView }) {
    const { t } = useTranslation('shell');
    /* A view draws from the project document, and a drawing or a diagram from a file of its own as
       well. Reading an editor this cell has none of is the blank one, which never changes. */
    const rev = useProject((s) => s.rev);
    const drawing = useDrawing((s) => s.elements);
    const diagram = useDiagram((s) => s.content);
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
    const empty = useDocument((s) => !s.views.some(isOpenableView));
    const projectId = useProject((s) => s.current?.projectId);
    return empty ? (
        <ErrorBoundary label={t('projectStart.failed')} resetKeys={[projectId]}>
            <ProjectStartScreen />
        </ErrorBoundary>
    ) : (
        <SplitGrid />
    );
}
