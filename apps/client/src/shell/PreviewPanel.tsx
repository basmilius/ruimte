import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import { hasOverlayControls, isApplePlatform } from '@/desktop/bridge';
import { FileTabs } from '@/shell/panels/FileTabs';
import { FileViewer } from '@/shell/panels/FileViewer';
import { clampColumnWidth, useColumnResize } from '@/shell/useColumnResize';
import { useInstantWidth } from '@/shell/useInstantWidth';
import { focusedCanvas } from '@/state/canvas';
import { useFiles } from '@/state/files';
import { useUi } from '@/state/ui';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Separator } from '@/ui/Separator';
import { Tooltip } from '@/ui/Tooltip';
import { CANVAS_SHORTCUTS } from '@/canvas/shortcuts';
import { matchesShortcut } from '@/ui/shortcut';

const MIN_WIDTH = 360;
// Half a wide canvas is more room than a file needs, so the width it opens with stops here.
const MAX_DEFAULT_WIDTH = 720;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;
// How long the open and close motion takes; the same number as `.panel-shell` in `styles.css`.
const TRANSITION_MS = 200;

/* Half of the room the canvas had, which is what the preview opens with until a drag says otherwise. */
const halfOfCanvas = (): number => {
    const canvas = focusedCanvas().getState().viewport.w || window.innerWidth;
    return Math.max(MIN_WIDTH, Math.min(MAX_DEFAULT_WIDTH, Math.floor(canvas / 2)));
};

/* The file preview, between the canvas and the files panel. It is a panel of its own: the files
   panel can close while a file stays open, and the preview can close while the tree stays up. Like
   the panel beside it, it stays mounted and animates its width over an inner column of the stored
   width, so its contents do not reflow while it slides in or out. */
export function PreviewPanel() {
    const { t } = useTranslation('shell');
    const activeTab = useFiles((s) => s.active);
    const open = useUi((s) => s.preview.open);
    const panelOpen = useUi((s) => s.panel.open);
    const stored = useUi((s) => s.previewWidth);
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
    const bodyRef = useRef<HTMLDivElement>(null);
    /* Counts what was opened by hand, in the files panel, the git panel or the palette. */
    const focusRequest = useFiles((s) => s.focusRequest);
    /* What a project with no width of its own gets, taken the moment the preview opens: half of
       what the canvas has right then. From the first drag on, the width the project remembers is
       the person's and this stays out of it. */
    const [appWidth, setAppWidth] = useState(halfOfCanvas);
    const [wasOpen, setWasOpen] = useState(open);
    if (open !== wasOpen) {
        setWasOpen(open);
        if (open) {
            setAppWidth(halfOfCanvas());
        }
    }
    const bounds = { min: MIN_WIDTH, max: () => window.innerWidth - MIN_CANVAS_WIDTH };
    // The project may have been on a wider window than this one, so its width is clamped on the way in.
    const width = clampColumnWidth(bounds, stored ?? appWidth);
    const { startResize } = useColumnResize(ref, {
        ...bounds,
        width,
        from: 'right',
        onWidth: (next) => useUi.getState().setPreviewWidth(next)
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

    useEffect(() => {
        if (focusRequest === 0) {
            return;
        }
        /* A frame later, not now: the palette that opened this file is still closing, and a dialog
           puts focus back where it found it on its way out. */
        const frame = requestAnimationFrame(() => bodyRef.current?.focus());
        return () => {
            window.cancelAnimationFrame(frame);
        };
    }, [focusRequest]);

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        const { tabs, active } = useFiles.getState();
        if (!active) {
            return;
        }
        if (matchesShortcut(CANVAS_SHORTCUTS.closeCell, event, isApplePlatform())) {
            event.preventDefault();
            useFiles.getState().close(active);
        } else if (event.key === 'Tab' && event.ctrlKey && tabs.length > 1) {
            event.preventDefault();
            const index = tabs.findIndex((tab) => tab.key === active);
            const next = tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
            if (next) {
                useFiles.getState().activate(next.key);
            }
        }
    };

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
                <div
                    ref={bodyRef}
                    /* Focusable by script alone: opening a file hands it the keyboard, so ⌘W closes
                       the tab that just opened without a click first. */
                    tabIndex={-1}
                    className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface outline-none"
                    style={{ width }}
                    onKeyDown={onKeyDown}
                >
                    {open && <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />}
                    {/* The Files or Git panel sits right of this one, so the preview only takes the
                        window controls' inset when it is the rightmost column on its own. */}
                    <header
                        className={clsx(
                            'app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border pr-2',
                            open && !panelOpen && hasOverlayControls() && 'toolbar-overlay-inset'
                        )}
                    >
                        <FileTabs />
                        <Separator />
                        <Tooltip label={t('preview.closeAll')} name>
                            <button className="icon-btn" onClick={() => useFiles.getState().closeAll()}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                    </header>
                    {/* The tabs above stay, so another file is one click away from a broken one. */}
                    <ErrorBoundary label={t('preview.failed')} resetKeys={[activeTab]} className="min-h-0 grow">
                        <FileViewer />
                    </ErrorBoundary>
                </div>
            )}
        </aside>
    );
}
