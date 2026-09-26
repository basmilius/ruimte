import { useContentSize } from './useContentSize.ts';

/* A plot draws in real pixels rather than a stretched view box, so what it draws lands on whole ones. */
export function useMeasuredWidth(): [(node: HTMLDivElement | null) => void, number] {
    const [measure, size] = useContentSize();
    return [measure, size.width];
}
