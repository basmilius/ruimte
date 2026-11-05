import { ColumnResizeHandle, useColumnResize } from '@adecore/ui';
import clsx from 'clsx';
import { useRef, type CSSProperties, type ReactNode } from 'react';

/* The narrowest a commit's tree goes, which a patch's tree shares since both are drawn at one width. */
export const COMMIT_TREE_MIN_WIDTH = 160;

interface TreeSplitProps {
    /* The column with the tree; null draws the body alone. */
    side: ReactNode;
    width: number;
    /* Room for a name and its counts; the column never takes more than half the view either. */
    minWidth: number;
    onWidth(width: number): void;
    /* The height the column keeps while it stands above the body. */
    stackedHeight: 'h-60' | 'h-72';
    children: ReactNode;
}

/*
 * A tree of files beside what it picks, the way a commit tab lays one out. Too narrow for the two side
 * by side, the tree stands above at a height it cannot grow past. The body stays the last child in both
 * states, so showing or hiding the tree never mounts it again.
 */
export function TreeSplit({ side, width, minWidth, onWidth, stackedHeight, children }: TreeSplitProps) {
    const bodyRef = useRef<HTMLDivElement>(null);
    const sideRef = useRef<HTMLElement>(null);
    const { startResize } = useColumnResize(sideRef, {
        size: width,
        min: minWidth,
        from: 'left',
        max: () => Math.floor((bodyRef.current?.getBoundingClientRect().width ?? 0) / 2),
        onSize: onWidth
    });

    return (
        <div ref={bodyRef} className="@container flex min-h-0 grow flex-col">
            <div className="flex min-h-0 grow flex-col @xl:flex-row">
                {side !== null && (
                    <aside
                        ref={sideRef}
                        className={clsx(
                            'relative flex max-h-1/2 min-h-0 shrink-0 flex-col border-b border-border bg-surface @xl:h-auto @xl:max-h-none @xl:w-(--tree-width) @xl:max-w-1/2 @xl:border-r @xl:border-b-0',
                            stackedHeight
                        )}
                        style={{ '--tree-width': `${width}px` } as CSSProperties}
                    >
                        {side}
                        <ColumnResizeHandle from="left" className="hidden @xl:block" onPointerDown={startResize} />
                    </aside>
                )}
                {children}
            </div>
        </div>
    );
}
