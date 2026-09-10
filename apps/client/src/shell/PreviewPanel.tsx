import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { X } from 'lucide-react';
import { FileTabs } from '@/shell/panels/FileTabs';
import { FileViewer } from '@/shell/panels/FileViewer';
import { hasStoredWidth, useColumnResize } from '@/shell/useColumnResize';
import { useCanvas } from '@/state/canvas';
import { useFiles } from '@/state/files';
import { useUi } from '@/state/ui';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const STORAGE_KEY = 'ruimte.preview.width';
const MIN_WIDTH = 360;
// Half a wide canvas is more room than a file needs, so the width it opens with stops here.
const MAX_DEFAULT_WIDTH = 720;
// A drag stops here instead of squeezing the canvas away.
const MIN_CANVAS_WIDTH = 360;
// How long the open and close motion takes; the same number as the class below.
const TRANSITION_MS = 200;

/* Half of the room the canvas had, which is what the preview opens with until a drag says otherwise. */
const halfOfCanvas = (): number => {
    const canvas = useCanvas.getState().viewport.w || window.innerWidth;
    return Math.max(MIN_WIDTH, Math.min(MAX_DEFAULT_WIDTH, Math.floor(canvas / 2)));
};

/* The file preview, between the canvas and the files panel. It is a panel of its own: the files
   panel can close while a file stays open, and the preview can close while the tree stays up. Like
   the panel beside it, it stays mounted and animates its width over an inner column of the stored
   width, so its contents do not reflow while it slides in or out. */
export function PreviewPanel() {
    const open = useUi((s) => s.preview.open);
    /* Closed and done animating. Until then the contents stay mounted, so a close plays out. */
    const [settled, setSettled] = useState(!open);
    const present = open || !settled;
    const ref = useRef<HTMLElement>(null);
    const { width, setWidth, startResize } = useColumnResize(ref, {
        storageKey: STORAGE_KEY,
        defaultWidth: MAX_DEFAULT_WIDTH,
        min: MIN_WIDTH,
        from: 'right',
        max: () => window.innerWidth - MIN_CANVAS_WIDTH
    });

    /* Every open takes half of what the canvas has, until the person drags the edge themselves:
       from then on the width in storage is theirs and the rule stays out of it. */
    useLayoutEffect(() => {
        if (open && !hasStoredWidth(STORAGE_KEY)) {
            setWidth(halfOfCanvas());
        }
    }, [open, setWidth]);

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

    const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>): void => {
        const { tabs, active } = useFiles.getState();
        if (!active) {
            return;
        }
        if (event.key === 'w' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault();
            useFiles.getState().close(active);
        } else if (event.key === 'Tab' && event.ctrlKey && tabs.length > 1) {
            event.preventDefault();
            const index = tabs.findIndex((tab) => tab.path === active);
            const next = tabs[(index + (event.shiftKey ? -1 : 1) + tabs.length) % tabs.length];
            if (next) {
                useFiles.getState().activate(next.path);
            }
        }
    };

    return (
        <aside
            ref={ref}
            inert={!open}
            className="panel-shell flex h-full shrink-0 justify-end overflow-hidden transition-[width] duration-200 ease-out"
            style={{ width: open ? width : 0 }}
            onTransitionEnd={(event) => {
                if (event.propertyName === 'width' && event.target === event.currentTarget) {
                    setSettled(!open);
                }
            }}
        >
            {present && (
                <div className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface" style={{ width }} onKeyDown={onKeyDown}>
                    {open && <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />}
                    <header className="app-drag flex h-12 shrink-0 items-center gap-2 border-b border-border pr-3 pl-2">
                        <FileTabs />
                        <Tooltip label="Close preview" name>
                            <button className="icon-btn" onClick={() => useUi.getState().setPreviewOpen(false)}>
                                <Icon icon={X} size={16} />
                            </button>
                        </Tooltip>
                    </header>
                    <FileViewer />
                </div>
            )}
        </aside>
    );
}
