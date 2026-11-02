'use client';

import { type ReactNode, useEffect, useRef, useState } from 'react';

/*
 * A mockup is drawn at one fixed size and scaled to the width of the page, so it keeps the proportions of
 * the app from a phone up. The caption is its text alternative; the picture itself is hidden from a
 * screen reader.
 */
export function MockStage({
    width,
    height,
    caption,
    children
}: {
    readonly width: number;
    readonly height: number;
    readonly caption: string;
    readonly children: ReactNode;
}) {
    const stage = useRef<HTMLDivElement>(null);
    const [scale, setScale] = useState(1);

    useEffect(() => {
        const element = stage.current;

        if (element === null) {
            return;
        }

        const observer = new ResizeObserver(() => {
            setScale(Math.min(1, element.clientWidth / width));
        });

        observer.observe(element);

        return () => observer.disconnect();
    }, [width]);

    return (
        <figure className="mock-figure">
            <div ref={stage} className="mock-stage" style={{ aspectRatio: `${width} / ${height}`, maxWidth: width }} aria-hidden>
                <div className="mock-stage-inner" style={{ width, height, transform: `scale(${scale})` }}>
                    {children}
                </div>
            </div>
            <figcaption>{caption}</figcaption>
        </figure>
    );
}
