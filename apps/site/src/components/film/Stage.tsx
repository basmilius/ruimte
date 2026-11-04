'use client';

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { PlaybackContext, useStagePlayback } from './playback.ts';

interface SceneProps {
    readonly width: number;
    readonly height: number;
    readonly label: string;
    readonly className?: string;
    readonly children: ReactNode;
}

/**
 * A scene drawn at a fixed size and scaled to its container, so every node keeps its place from a
 * phone to a wide screen. The drawing is one image to a screen reader, described by `label`.
 */
export function Scaled({ width, height, label, className = '', children }: SceneProps) {
    const ref = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState<number | null>(null);

    useLayoutEffect(() => {
        const element = ref.current;
        if (!element) {
            return;
        }
        const resize = new ResizeObserver(([entry]) => setScale(entry.contentRect.width / width));
        resize.observe(element);
        return () => resize.disconnect();
    }, [width]);

    // Until the first measure the drawing is at its full size, so the frame clips it rather than let a phone's page
    // scroll sideways; the margin keeps the shadows of nodes at the edge.
    return (
        <div
            ref={ref}
            role="img"
            aria-label={label}
            className={`relative w-full overflow-clip [overflow-clip-margin:16px] ${className}`}
            style={{ aspectRatio: `${width} / ${height}` }}
        >
            <div
                aria-hidden
                inert
                className="absolute top-0 left-0 origin-top-left"
                style={{ width, height, transform: `scale(${scale ?? 1})`, opacity: scale === null ? 0 : 1 }}
            >
                {children}
            </div>
        </div>
    );
}

/** A scaled scene that plays while it is on screen. */
export function Stage(props: SceneProps) {
    const ref = useRef<HTMLDivElement>(null);
    const playback = useStagePlayback(ref);
    return (
        <div ref={ref}>
            <PlaybackContext value={playback}>
                <Scaled {...props} />
            </PlaybackContext>
        </div>
    );
}
