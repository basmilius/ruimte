import { useEffect, useRef, useState } from 'react';

/* A plot draws in real pixels rather than a stretched view box, so what it draws lands on whole ones. */
export function useMeasuredWidth(): [(node: HTMLDivElement | null) => void, number] {
    const [width, setWidth] = useState(0);
    const observer = useRef<ResizeObserver | null>(null);
    useEffect(() => () => observer.current?.disconnect(), []);
    const measure = (node: HTMLDivElement | null): void => {
        observer.current?.disconnect();
        if (node === null) {
            return;
        }
        setWidth(node.clientWidth);
        observer.current = new ResizeObserver(([entry]) => setWidth(Math.round(entry!.contentRect.width)));
        observer.current.observe(node);
    };
    return [measure, width];
}
