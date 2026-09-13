import { useEffect } from 'react';
import { FolderOpen } from 'lucide-react';
import { isCanvasView, isFileView, type ProjectView } from '@ruimte/contracts';
import { Canvas } from '@/canvas/Canvas';
import { SplitGrid } from '@/shell/SplitGrid';
import { DrawingView } from '@/drawing/DrawingView';
import { drawingCanClear } from '@/drawing/use-drawing-keys';
import { BrowserFallback, usePage } from '@/nodes/BrowserBody';
import { ChatBody } from '@/nodes/ChatBody';
import { TerminalBody } from '@/nodes/TerminalBody';
import { FileSurface } from '@/shell/panels/FileSurface';
import { useDocument } from '@/state/document';
import { useProject } from '@/state/project';
import { useUi } from '@/state/ui';
import { UsagePage } from '@/shell/usage/UsagePage';
import { isApplePlatform } from '@/desktop/bridge';
import { isLeaveNodeChord } from '@/terminal/keymap';
import { focusViewRow } from '@/shell/sidebar-focus';
import { Button } from '@/ui/Button';
import { TOOLTIP_KBD } from '@/ui/classes';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { isInFloatingLayer } from '@/ui/floating';

/*
 * A view of its own has no canvas to fall back to, so leaving its body puts the keyboard on its row
 * in the sidebar. A chat leaves on Escape; a terminal hands Escape to the program it runs and leaves
 * on the same chord a terminal node uses.
 */
const useLeaveOnEscape = (view: ProjectView): void => {
    useEffect(() => {
        const onKeyDown = (e: KeyboardEvent): void => {
            const leaving = view.kind === 'terminal' ? isLeaveNodeChord(e, isApplePlatform()) : e.key === 'Escape' && !e.metaKey && !e.ctrlKey && !e.altKey;
            // An open popup or dialog owns Escape; it closes itself and the body keeps the keyboard.
            // Every cell has this listener, so only the one the keyboard is in may answer.
            if (!leaving || !useDocument.getState().bodyFocused || useDocument.getState().activeViewId !== view.id || isInFloatingLayer(e.target)) {
                return;
            }
            // A drawing clears its draft, its selection and its tool first; only an empty one is left.
            if (view.kind === 'drawing' && drawingCanClear()) {
                return;
            }
            e.preventDefault();
            useDocument.getState().setBodyFocused(false);
            focusViewRow(view.id);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [view.id, view.kind]);
};

function StandaloneView({ view }: { view: ProjectView }) {
    const focused = useDocument((s) => s.bodyFocused);
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
            {view.kind === 'drawing' && <DrawingView id={view.id} />}
            {/* No column around it: prose centers itself at 768px inside its own renderer, and
                code wants every pixel the window has. */}
            {isFileView(view) && <FileSurface path={view.path} on="view" />}
        </div>
    );
}

/* The page of a browser view is the parked element, placed over this whole column by the layer. */
function BrowserViewSurface({ id }: { id: string }) {
    const { available } = usePage(id);
    return available ? <div className="h-full bg-surface-sunken" /> : <BrowserFallback id={id} />;
}

/*
 * No project open, which is where a fresh install and a machine that has just been paired both
 * start. Nothing is wrong, nothing is loading: a project is a thing you pick, and these are the two
 * ways to pick one.
 */
function NoProject() {
    return (
        <div className="absolute inset-0 grid place-items-center bg-surface-sunken">
            <EmptyState
                icon={<Icon icon={FolderOpen} size={20} />}
                action={
                    <div className="flex items-center gap-2">
                        <Button variant="secondary" onClick={() => useUi.getState().openPalette()}>
                            Open a project
                        </Button>
                        <Button variant="secondary" onClick={() => useUi.getState().openFolderBrowser()}>
                            Open a folder
                        </Button>
                    </div>
                }
            >
                No project is open. Press <kbd className={TOOLTIP_KBD}>⌘K</kbd> for one you already have, or open a folder to start a new one.
            </EmptyState>
        </div>
    );
}

/*
 * One cell of the grid. A canvas view draws the canvas; every other kind draws the body of its one
 * node, without a frame. A cell draws what its view is and nothing else: the canvas used to stay
 * mounted under every other kind because it carried the app's chords, and with up to nine cells that
 * would mean nine hidden canvases. The chords moved to the workspace (`canvas/canvas-chords.ts`).
 */
export function ViewSurface({ view }: { view: ProjectView }) {
    return isCanvasView(view) ? <Canvas /> : <StandaloneView view={view} />;
}

/*
 * The main column: the grid of cells, or what stands in for it. An app-level page belongs to the
 * machine and not to the project, so it covers the whole column and hands it back untouched when it
 * closes; with no project open there is no grid to draw at all.
 */
export function ViewHost() {
    const page = useUi((s) => s.page);
    const hasProject = useProject((s) => s.current !== null);
    return (
        <>
            {page === null && hasProject && <SplitGrid />}
            {page === null && !hasProject && <NoProject />}
            {page === 'usage' && <UsagePage />}
        </>
    );
}
