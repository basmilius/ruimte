import { useEffect, useRef, useState } from 'react';
import { X } from 'lucide-react';
import { PanelControls } from '@/shell/PanelControls';
import { PANELS } from '@/shell/panels';
import { FilesPanel } from '@/shell/panels/FilesPanel';
import { useColumnResize } from '@/shell/useColumnResize';
import { useUi, type PanelKind } from '@/state/ui';
import { EmptyState } from '@/ui/EmptyState';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const STORAGE_KEY = 'ruimte.panel.width';
const DEFAULT_WIDTH = 540;
const MIN_WIDTH = 360;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;
// How long the open and close motion takes; the same number as the class below.
const TRANSITION_MS = 200;

function PanelBody({ kind, label }: { kind: PanelKind; label: string }) {
    if (kind === 'files') {
        return <FilesPanel />;
    }
    return (
        <div className="grid grow place-items-center">
            <EmptyState>The {label.toLowerCase()} panel is next: it has nothing to show yet.</EmptyState>
        </div>
    );
}

/* The surface right of the canvas, spanning the whole main column so its header lines up with the
   toolbar and the top band stays unbroken. It is a split, not an overlay, so the canvas keeps a
   size of its own and every terminal in it refits instead of being covered. The element stays
   mounted and animates its width, over an inner column that keeps the stored width and hangs from
   the right, so the contents do not reflow and the controls in the header keep the window's edge
   while the panel slides in or out. */
export function Panel() {
    const panel = useUi((s) => s.panel);
    /* Closed and done animating. Until then the contents stay mounted, so a close plays out. */
    const [settled, setSettled] = useState(!panel.open);
    const present = panel.open || !settled;
    const ref = useRef<HTMLElement>(null);
    const { width, startResize } = useColumnResize(ref, {
        storageKey: STORAGE_KEY,
        defaultWidth: DEFAULT_WIDTH,
        min: MIN_WIDTH,
        from: 'right',
        max: () => window.innerWidth - MIN_CANVAS_WIDTH
    });

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
                        <span className="section-label">{label}</span>
                        <span className="grow" />
                        <Tooltip label={`Close ${label}`} kbd="⌘⌥B" name>
                            <button className="icon-btn" onClick={() => useUi.getState().setPanel({ open: false })}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                        {panel.open && <PanelControls />}
                    </header>
                    <PanelBody kind={panel.kind} label={label} />
                </div>
            )}
        </aside>
    );
}
