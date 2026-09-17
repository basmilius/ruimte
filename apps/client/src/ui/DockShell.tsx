import { useEffect, useRef, useState, type HTMLAttributes, type ReactNode } from 'react';
import clsx from 'clsx';
import { useSettings } from '@/state/settings';
import { FLOAT } from '@/ui/classes';

/* How close to the bottom of the window the pointer has to come before a hidden dock slides back. */
const REVEAL_ZONE = 120;

interface DockShellProps extends HTMLAttributes<HTMLDivElement> {
    children: ReactNode;
    /* Classes for the bar itself; the drawing dock has enough buttons to wrap. */
    barClassName?: string;
    /* Told whenever the bar slides away or comes back, for what stands on top of it. */
    onHiddenChange?: (hidden: boolean) => void;
}

/*
 * The floating bar at the bottom of a canvas or a drawing, and the one place that knows how to get
 * out of the way. With "Hide the dock" on it waits below the edge until the pointer comes down to
 * it, an open menu keeps it up (it would take its own popup with it), and a keyboard reaches it by
 * tabbing: the buttons stay in the tab order while it is out of sight, so focus brings it back.
 */
export function DockShell({ children, className, barClassName, onHiddenChange, ...rest }: DockShellProps) {
    const autoHide = useSettings((s) => s.dockAutoHide);
    const barRef = useRef<HTMLDivElement>(null);
    const [revealed, setRevealed] = useState(false);

    useEffect(() => {
        if (!autoHide) {
            return;
        }
        let pointerNear = false;
        const evaluate = (): void => {
            const bar = barRef.current;
            const holds = bar !== null && (bar.querySelector('[data-popup-open]') !== null || bar.querySelector(':focus-visible') !== null);
            setRevealed(pointerNear || holds);
        };
        const onMove = (event: PointerEvent): void => {
            /* Something that moves with the dock (a prompt stack) would slide away under the pointer
               reaching for it, so over one the dock stays as it is. */
            if (event.target instanceof Element && event.target.closest('[data-holds-dock]') !== null) {
                return;
            }
            pointerNear = window.innerHeight - event.clientY <= REVEAL_ZONE;
            evaluate();
        };
        window.addEventListener('pointermove', onMove);
        window.addEventListener('focusin', evaluate);
        return () => {
            window.removeEventListener('pointermove', onMove);
            window.removeEventListener('focusin', evaluate);
            setRevealed(false);
        };
    }, [autoHide]);

    const hidden = autoHide && !revealed;
    useEffect(() => {
        onHiddenChange?.(hidden);
    }, [hidden, onHiddenChange]);
    return (
        <div {...rest} className={clsx('pointer-events-none absolute inset-x-0 bottom-4 flex justify-center', className)}>
            <div
                ref={barRef}
                className={clsx(
                    FLOAT,
                    'flex items-center gap-2 rounded-xl p-1 transition-[opacity,translate] duration-200',
                    barClassName,
                    hidden ? 'pointer-events-none translate-y-6 opacity-0' : 'pointer-events-auto'
                )}
            >
                {children}
            </div>
        </div>
    );
}
