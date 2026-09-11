import { useEffect } from 'react';
import clsx from 'clsx';
import { FolderOpen } from 'lucide-react';
import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import { Canvas } from '@/canvas/Canvas';
import { DrawingView } from '@/drawing/DrawingView';
import { drawingCanClear } from '@/drawing/use-drawing-keys';
import { BrowserFallback, usePage } from '@/nodes/BrowserBody';
import { ChatBody } from '@/nodes/ChatBody';
import { TerminalBody } from '@/nodes/TerminalBody';
import { activeViewOf, useDocument } from '@/state/document';
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
            if (!leaving || !useDocument.getState().bodyFocused || isInFloatingLayer(e.target)) {
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
            {/* A thread that runs the whole window is unreadable, so a chat of its own keeps the column
                at 768px of content, centered, with the surface filling what is left
                beside it. The scroller itself stays the width of the column, so its scrollbar sits at
                the column's own edge (`.chat-column` in `styles.css`). At that width the thread reads
                at 15px over 24px, which every `text-sm` inside it follows; the chrome keeps its own
                size and code keeps `--text-code`. */}
            {view.kind === 'chat' && (
                <div className="chat-column flex h-full w-full flex-col [--text-sm:15px] [--text-sm--line-height:24px]">
                    <ChatBody id={view.id} focused={focused} />
                </div>
            )}
            {view.kind === 'terminal' && <TerminalBody id={view.id} focused={focused} />}
            {view.kind === 'browser' && <BrowserViewSurface id={view.id} />}
            {view.kind === 'drawing' && <DrawingView id={view.id} />}
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
 * The main column. A canvas view draws the canvas; every other kind draws the body of its one node,
 * without a frame. The canvas stays mounted either way: it owns the app's pointer and key handling,
 * and its terminals keep their screens instead of rebuilding on the way back. An app-level page is
 * neither: it belongs to the machine and not to the project, so it draws over whatever is active
 * and hands the column back untouched when it closes.
 */
export function ViewHost() {
    const view = useDocument((s) => activeViewOf(s));
    const page = useUi((s) => s.page);
    const hasProject = useProject((s) => s.current !== null);
    const standalone = view !== null && !isCanvasView(view) ? view : null;
    /* The canvas keeps its place under the empty state for the same reason it keeps it under a page:
       it carries the app's chords, ⌘K among them, which is the one the empty state points at. */
    const covered = page !== null || standalone !== null || !hasProject;
    return (
        <>
            <div className={clsx('absolute inset-0', covered && 'invisible')} inert={covered}>
                <Canvas />
            </div>
            {page === null && standalone && <StandaloneView view={standalone} />}
            {page === null && standalone === null && !hasProject && <NoProject />}
            {page === 'usage' && <UsagePage />}
        </>
    );
}
