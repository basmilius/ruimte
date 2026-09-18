import { useEffect, useRef, useState } from 'react';
import clsx from 'clsx';
import { X } from 'lucide-react';
import { hasOverlayControls } from '@/desktop/bridge';
import { PANELS } from '@/shell/panels';
import { PanelHeaderProvider } from '@/shell/PanelHeaderSlot';
import { FilesPanel } from '@/shell/panels/FilesPanel';
import { GitPanel } from '@/shell/panels/GitPanel';
import { ProcessesPanel } from '@/shell/panels/ProcessesPanel';
import { DevicesPanel } from '@/shell/panels/DevicesPanel';
import { clampColumnWidth, useColumnResize } from '@/shell/useColumnResize';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { useUi, type PanelKind } from '@/state/ui';
import { SECTION_LABEL } from '@/ui/classes';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';

const DEFAULT_WIDTH = 540;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;
// How long the open and close motion takes; the same number as `.panel-shell` in `styles.css`.
const TRANSITION_MS = 200;

function PanelBody({ kind }: { kind: PanelKind }) {
    switch (kind) {
        case 'files':
            return <FilesPanel />;
        case 'git':
            return <GitPanel />;
        case 'processes':
            return <ProcessesPanel />;
        case 'devices':
            return <DevicesPanel />;
    }
}

/* Keep the inner column at its stored width while the outer split animates, avoiding content reflow. */
export function Panel() {
    const panel = useUi((s) => s.panel);
    const open = panel.open;
    const [leadingHeaderSlot, setLeadingHeaderSlot] = useState<HTMLElement | null>(null);
    const [titleSignal, setTitleSignal] = useState<HTMLElement | null>(null);
    const [headerSlot, setHeaderSlot] = useState<HTMLElement | null>(null);
    const stored = useUi((s) => s.panelWidth);
    /* Closed and done animating. Until then the contents stay mounted, so a close plays out. */
    const [settled, setSettled] = useState(!open);
    const instant = useInstantWidth();
    /* A width that lands without a transition fires no `transitionend`, so the motion it would have
       ended is over in the same commit that starts it. */
    if (instant && settled !== !open) {
        setSettled(!open);
    }
    const present = open || !settled;
    const ref = useRef<HTMLElement>(null);
    const entry = PANELS.find((candidate) => candidate.kind === panel.kind);
    const bounds = { min: entry?.minWidth ?? 240, max: () => window.innerWidth - MIN_CANVAS_WIDTH };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnWidth(bounds, stored ?? DEFAULT_WIDTH);
    const { startResize } = useColumnResize(ref, {
        ...bounds,
        width,
        from: 'right',
        onWidth: (next) => useUi.getState().setPanelWidth(next)
    });

    useEffect(() => {
        if (open || settled) {
            return;
        }
        // Reduced motion and a hidden tab paint no width change, so no `transitionend` arrives.
        const timer = window.setTimeout(() => setSettled(true), TRANSITION_MS + 50);
        return () => {
            window.clearTimeout(timer);
        };
    }, [open, settled]);

    const label = entry?.label ?? 'Panel';

    return (
        <aside
            ref={ref}
            inert={!open}
            data-instant={instant ? '' : undefined}
            className="panel-shell flex h-full shrink-0 justify-end overflow-hidden"
            style={{ width: open ? width : 0 }}
            onTransitionEnd={(event) => {
                if (event.propertyName === 'width' && event.target === event.currentTarget) {
                    setSettled(!open);
                }
            }}
        >
            {present && (
                <div className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface" style={{ width }}>
                    {open && <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />}
                    {/* An open panel is the rightmost column, so on Windows and Linux the close button
                        would land under the native window controls; the inset keeps their width free. */}
                    <header
                        className={clsx(
                            'app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2 pl-3',
                            open && hasOverlayControls() && 'toolbar-overlay-inset'
                        )}
                    >
                        <div ref={setLeadingHeaderSlot} className="contents" />
                        <div ref={setTitleSignal} className="panel-title-signal hidden" />
                        <span className={`${SECTION_LABEL} panel-title shrink-0`}>{label}</span>
                        {/* The panel's own controls, between its name and the close button. */}
                        <div ref={setHeaderSlot} className="flex min-w-0 grow items-center gap-2" />
                        <Tooltip label={`Close ${label}`} kbd={CANVAS_SHORTCUTS.togglePanel} name>
                            <button className="icon-btn shrink-0" onClick={() => useUi.getState().setPanel({ open: false })}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                    </header>
                    <PanelHeaderProvider hosts={{ leading: leadingHeaderSlot, titleSignal, trailing: headerSlot }}>
                        <ErrorBoundary label="This panel failed to render" resetKeys={[panel.kind]} className="min-h-0 grow">
                            <PanelBody kind={panel.kind} />
                        </ErrorBoundary>
                    </PanelHeaderProvider>
                </div>
            )}
        </aside>
    );
}
