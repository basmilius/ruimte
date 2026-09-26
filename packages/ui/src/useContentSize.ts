import { useCallback, useEffect, useRef, useState } from 'react';

export interface ContentSize {
    width: number;
    height: number;
}

/* Whole pixels, so a frame fitted into the space lands on them too. */
export function useContentSize(): [(node: HTMLDivElement | null) => void, ContentSize] {
    const [size, setSize] = useState<ContentSize>({ width: 0, height: 0 });
    const observer = useRef<ResizeObserver | null>(null);
    useEffect(() => () => observer.current?.disconnect(), []);
    const measure = useCallback((node: HTMLDivElement | null): void => {
        observer.current?.disconnect();
        if (node === null) {
            return;
        }
        const update = (width: number, height: number): void => {
            const next = { width: Math.round(width), height: Math.round(height) };
            setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
        };
        update(node.clientWidth, node.clientHeight);
        observer.current = new ResizeObserver(([entry]) => update(entry!.contentRect.width, entry!.contentRect.height));
        observer.current.observe(node);
    }, []);
    return [measure, size];
}
