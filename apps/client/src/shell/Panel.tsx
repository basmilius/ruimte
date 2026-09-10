import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { X } from 'lucide-react';
import { PanelControls } from '@/shell/PanelControls';
import { PANELS } from '@/shell/panels';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const STORAGE_KEY = 'ruimte.panel.width';
const DEFAULT_WIDTH = 540;
const MIN_WIDTH = 360;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;
// How long the open and close motion takes; the same number as the class below.
const TRANSITION_MS = 200;

const clampWidth = (width: number): number => Math.max(MIN_WIDTH, Math.min(width, Math.max(MIN_WIDTH, window.innerWidth - MIN_CANVAS_WIDTH)));

const readWidth = (): number => {
    try {
        const raw = localStorage.getItem(STORAGE_KEY);
        const stored = raw ? Number.parseInt(raw, 10) : Number.NaN;
        return Number.isFinite(stored) ? clampWidth(stored) : DEFAULT_WIDTH;
    } catch {
        return DEFAULT_WIDTH;
    }
};

const persistWidth = (width: number): void => {
    try {
        localStorage.setItem(STORAGE_KEY, String(width));
    } catch {
        // Storage that refuses keeps the width for this session only.
    }
};

/* The surface right of the canvas, spanning the whole main column so its header lines up with the
   toolbar and the top band stays unbroken. It is a split, not an overlay, so the canvas keeps a
   size of its own and every terminal in it refits instead of being covered. The element stays
   mounted and animates its width, over an inner column that keeps the stored width and hangs from
   the right, so the contents do not reflow and the controls in the header keep the window's edge
   while the panel slides in or out. */
export function Panel() {
    const panel = useUi((s) => s.panel);
    const [width, setWidth] = useState(readWidth);
    /* Closed and done animating. Until then the contents stay mounted, so a close plays out. */
    const [settled, setSettled] = useState(!panel.open);
    const present = panel.open || !settled;
    const ref = useRef<HTMLElement>(null);

    useEffect(() => {
        if (panel.open || settled) {
            return;
        }
        // Reduced motion and a hidden tab paint no width change, so no `transitionend` arrives.
        const timer = window.setTimeout(() => setSettled(true), TRANSITION_MS + 50);
        return () => {
            window.clearTimeout(timer);
        };
    }, [panel.open, settled]);

    const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const handle = event.currentTarget;
        const aside = ref.current;
        const right = aside?.getBoundingClientRect().right ?? window.innerWidth;
        let next = width;
        aside?.setAttribute('data-resizing', 'true');
        const onMove = (move: PointerEvent): void => {
            next = clampWidth(Math.round(right - move.clientX));
            setWidth(next);
        };
        const onUp = (): void => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.releasePointerCapture(event.pointerId);
            aside?.removeAttribute('data-resizing');
            persistWidth(next);
        };
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    const label = PANELS.find((entry) => entry.kind === panel.kind)?.label ?? 'Panel';

    return (
        <aside
            ref={ref}
            inert={!panel.open}
            className="panel-shell flex h-full shrink-0 justify-end overflow-hidden transition-[width] duration-200 ease-out"
            style={{ width: panel.open ? width : 0 }}
            onTransitionEnd={(event) => {
                if (event.propertyName === 'width' && event.target === event.currentTarget) {
                    setSettled(!panel.open);
                }
            }}
        >
            {present && (
                <div className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface" style={{ width }}>
                    {panel.open && <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />}
                    <header className="app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-3">
                        <span className="text-sm font-medium text-text">{label}</span>
                        <span className="grow" />
                        <Tooltip label="Close">
                            <button className="icon-btn" aria-label={`Close ${label}`} onClick={() => useUi.getState().setPanel({ open: false })}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                        {panel.open && <PanelControls />}
                    </header>
                    <div className="grid grow place-items-center p-4 text-xs text-text-faint">Nothing here yet.</div>
                </div>
            )}
        </aside>
    );
}
