import { useEffect } from 'react';
import clsx from 'clsx';
import { isCanvasView, type ProjectView } from '@ruimte/contracts';
import { Canvas } from '@/canvas/Canvas';
import { DrawingView } from '@/drawing/DrawingView';
import { drawingCanClear } from '@/drawing/use-drawing-keys';
import { BrowserFallback, usePage } from '@/nodes/BrowserBody';
import { ChatBody } from '@/nodes/ChatBody';
import { TerminalBody } from '@/nodes/TerminalBody';
import { activeViewOf, useDocument } from '@/state/document';
import { isApplePlatform } from '@/desktop/bridge';
import { isLeaveNodeChord } from '@/terminal/keymap';
import { focusViewRow } from '@/shell/sidebar-focus';
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
                T3 Code gives it: 768px of content, centered, with the surface filling what is left
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
 * The main column. A canvas view draws the canvas; every other kind draws the body of its one node,
 * without a frame. The canvas stays mounted either way: it owns the app's pointer and key handling,
 * and its terminals keep their screens instead of rebuilding on the way back.
 */
export function ViewHost() {
    const view = useDocument((s) => activeViewOf(s));
    const standalone = view !== null && !isCanvasView(view) ? view : null;
    return (
        <>
            <div className={clsx('absolute inset-0', standalone && 'invisible')} inert={standalone !== null}>
                <Canvas />
            </div>
            {standalone && <StandaloneView view={standalone} />}
        </>
    );
}
