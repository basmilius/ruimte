import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { hasOverlayControls } from '@/desktop/bridge';
import { PANELS } from '@/shell/panels';
import { PanelHeaderProvider } from '@/shell/PanelHeaderSlot';
import { FilesPanel } from '@/shell/panels/FilesPanel';
import { GitPanel } from '@/shell/panels/GitPanel';
import { clampColumnWidth, useColumnResize } from '@/shell/useColumnResize';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { useUi, type PanelKind } from '@/state/ui';
import { SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const DEFAULT_WIDTH = 540;
const MIN_WIDTH = 240;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;
// How long the open and close motion takes; the same number as `.panel-shell` in `styles.css`.
const TRANSITION_MS = 200;

function PanelBody({ kind }: { kind: PanelKind }) {
    return kind === 'files' ? <FilesPanel /> : <GitPanel />;
}

/* The surface right of the canvas, spanning the whole main column so its header lines up with the
   toolbar and the top band stays unbroken. It is a split, not an overlay, so the canvas keeps a
   size of its own and every terminal in it refits instead of being covered. The element stays
   mounted and animates its width, over an inner column that keeps the stored width and hangs from
   the right, so the contents do not reflow and the controls in the header keep the window's edge
   while the panel slides in or out. */
export function Panel() {
    const panel = useUi((s) => s.panel);
    /* Where a panel hangs its own header controls; a callback ref, so the portal has an element
       the first time the panel body renders and not one commit later. */
    const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
    const stored = useUi((s) => s.panelWidth);
    /* Closed and done animating. Until then the contents stay mounted, so a close plays out. */
    const [settled, setSettled] = useState(!panel.open);
    const instant = useInstantWidth();
    /* A width that lands without a transition fires no `transitionend`, so the motion it would have
       ended is over in the same commit that starts it. */
    if (instant && settled !== !panel.open) {
        setSettled(!panel.open);
    }
    const present = panel.open || !settled;
    const ref = useRef<HTMLElement>(null);
    const bounds = { min: MIN_WIDTH, max: () => window.innerWidth - MIN_CANVAS_WIDTH };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnWidth(bounds, stored ?? DEFAULT_WIDTH);
    const { startResize } = useColumnResize(ref, {
        ...bounds,
        width,
        from: 'right',
        onWidth: (next) => useUi.getState().setPanelWidth(next)
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
            data-instant={instant ? '' : undefined}
            className="panel-shell flex h-full shrink-0 justify-end overflow-hidden"
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
                    {/* An open panel is the rightmost column, so on Windows and Linux the close button
                        would land under the native window controls; the inset keeps their width free. */}
                    <header
                        className={clsx(
                            'app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border px-3',
                            panel.open && hasOverlayControls() && 'toolbar-overlay-inset'
                        )}
                    >
                        <span className={`${SECTION_LABEL} shrink-0`}>{label}</span>
                        {/* The panel's own controls, between its name and the close button. */}
                        <div ref={setHeaderSlot} className="flex min-w-0 grow items-center gap-2" />
                        <Tooltip label={`Close ${label}`} kbd="⌘⌥B" name>
                            <button className="icon-btn shrink-0" onClick={() => useUi.getState().setPanel({ open: false })}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                    </header>
                    <PanelHeaderProvider value={headerSlot}>
                        <PanelBody kind={panel.kind} />
                    </PanelHeaderProvider>
                </div>
            )}
        </aside>
    );
}
