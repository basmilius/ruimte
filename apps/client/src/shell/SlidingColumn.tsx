import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type RefObject } from 'react';
import { useColumnResize } from '@/shell/useColumnResize';
import { useInstantWidth } from '@/shell/useInstantWidth';

// How long the open and close motion takes; the same number as `.panel-shell` in `styles.css`.
const TRANSITION_MS = 200;

interface SlidingColumnProps {
    open: boolean;
    /* Session-only panels do not participate in restoring the project layout. */
    restoreWithProject?: boolean;
    /* Already clamped by the caller, which knows what has to stay beside it. */
    width: number;
    bounds: { min: number; max(): number };
    onWidth(width: number): void;
    /* The shell itself, for bounds that measure what is beside it rather than the whole window. */
    columnRef?: RefObject<HTMLElement | null>;
    /*
     * The column takes the keyboard itself, for a panel with shortcuts of its own. It is focusable
     * by script alone, so opening a file hands it the keys without a click first.
     */
    body?: {
        ref: RefObject<HTMLDivElement | null>;
        onKeyDown(event: ReactKeyboardEvent<HTMLDivElement>): void;
    };
    children: ReactNode;
}

/*
 * A panel that slides in and out beside the canvas. The shell is a column of width 0 and inert
 * while closed; the contents sit in an inner column of the stored width, so they do not reflow
 * while it moves, and they stay mounted until the slide is over, so a close plays out. The left
 * edge is the drag handle.
 */
export function SlidingColumn({ open, restoreWithProject = true, width, bounds, onWidth, columnRef, body, children }: SlidingColumnProps) {
    /* Closed and done animating. Until then the contents stay mounted, so a close plays out. */
    const [settled, setSettled] = useState(!open);
    const restoring = useInstantWidth();
    const instant = restoreWithProject && restoring;
    /* A width that lands without a transition fires no `transitionend`, so the motion it would have
       ended is over in the same commit that starts it. */
    if (instant && settled !== !open) {
        setSettled(!open);
    }
    const present = open || !settled;
    const ownRef = useRef<HTMLElement>(null);
    const ref = columnRef ?? ownRef;
    const { startResize } = useColumnResize(ref, { ...bounds, size: width, from: 'right', onSize: onWidth });

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
                    ref={body?.ref}
                    tabIndex={body ? -1 : undefined}
                    className="relative flex h-full shrink-0 flex-col border-l border-border bg-surface outline-none"
                    style={{ width }}
                    onKeyDown={body?.onKeyDown}
                >
                    {open && <div className="absolute inset-y-0 left-0 z-10 w-2 cursor-col-resize" onPointerDown={startResize} />}
                    {children}
                </div>
            )}
        </aside>
    );
}
