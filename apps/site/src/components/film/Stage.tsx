'use client';

import { type ReactNode, useLayoutEffect, useRef, useState } from 'react';
import { PlaybackContext, useStagePlayback } from './playback.ts';

/**
 * A scene drawn at a fixed size and scaled to its container, so every node keeps its place from a
 * phone to a wide screen. The drawing is one image to a screen reader, described by `label`.
 */
export function Scaled({
    width,
    height,
    label,
    className = '',
    children
}: {
    readonly width: number;
    readonly height: number;
    readonly label: string;
    readonly className?: string;
    readonly children: ReactNode;
}) {
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

    return (
        <div ref={ref} role="img" aria-label={label} className={`relative w-full ${className}`} style={{ aspectRatio: `${width} / ${height}` }}>
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
export function Stage({
    width,
    height,
    label,
    className = '',
    children
}: {
    readonly width: number;
    readonly height: number;
    readonly label: string;
    readonly className?: string;
    readonly children: ReactNode;
}) {
    const ref = useRef<HTMLDivElement>(null);
    const playback = useStagePlayback(ref);
    return (
        <div ref={ref}>
            <PlaybackContext value={playback}>
                <Scaled width={width} height={height} label={label} className={className}>
                    {children}
                </Scaled>
            </PlaybackContext>
        </div>
    );
}
