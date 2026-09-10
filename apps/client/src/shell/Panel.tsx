import { useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { faXmark } from '@fortawesome/pro-regular-svg-icons';
import { PANELS } from '@/shell/panels';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const STORAGE_KEY = 'ruimte.panel.width';
const DEFAULT_WIDTH = 540;
const MIN_WIDTH = 360;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;

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

/* The surface right of the canvas, under the toolbar. It is a split, not an overlay, so the
   canvas keeps a size of its own and every terminal in it refits instead of being covered. */
export function Panel() {
    const panel = useUi((s) => s.panel);
    const [width, setWidth] = useState(readWidth);
    const ref = useRef<HTMLElement>(null);

    if (!panel.open) {
        return null;
    }

    const startResize = (event: ReactPointerEvent<HTMLDivElement>): void => {
        event.preventDefault();
        const handle = event.currentTarget;
        const right = ref.current?.getBoundingClientRect().right ?? window.innerWidth;
        let next = width;
        const onMove = (move: PointerEvent): void => {
            next = clampWidth(Math.round(right - move.clientX));
            setWidth(next);
        };
        const onUp = (): void => {
            handle.removeEventListener('pointermove', onMove);
            handle.removeEventListener('pointerup', onUp);
            handle.releasePointerCapture(event.pointerId);
            persistWidth(next);
        };
        handle.setPointerCapture(event.pointerId);
        handle.addEventListener('pointermove', onMove);
        handle.addEventListener('pointerup', onUp);
    };

    const label = PANELS.find((entry) => entry.kind === panel.kind)?.label ?? 'Panel';

    return (
        <aside ref={ref} className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface" style={{ width }}>
            <div className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />
            <header className="flex h-10 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3">
                <span className="text-sm font-medium text-text">{label}</span>
                <span className="grow" />
                <Tooltip label="Close">
                    <button className="icon-btn h-7 w-7" aria-label={`Close ${label}`} onClick={() => useUi.getState().setPanel({ open: false })}>
                        <Icon icon={faXmark} size={15} />
                    </button>
                </Tooltip>
            </header>
            <div className="grid grow place-items-center p-4 text-xs text-text-faint">Nothing here yet.</div>
        </aside>
    );
}
