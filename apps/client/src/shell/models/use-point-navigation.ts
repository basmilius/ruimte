import { useLayoutEffect, useRef, useState } from 'react';
import { movePoint } from './chart';

export function usePointNavigation(rows: readonly (readonly string[])[]) {
    const root = useRef<HTMLDivElement>(null);
    const nodes = useRef(new Map<string, SVGGElement>());
    const ownsFocus = useRef(false);
    const [focused, setFocused] = useState<string | null>(null);
    const [last, setLast] = useState<string | null>(null);
    const keys = rows.flat();
    const tabbable = last !== null && keys.includes(last) ? last : keys[0];

    useLayoutEffect(() => {
        if (ownsFocus.current && focused !== null && !keys.includes(focused)) {
            const target = tabbable === undefined ? root.current : nodes.current.get(tabbable);
            target?.focus();
        }
    }, [keys, focused, tabbable]);

    const focus = (key: string): void => {
        ownsFocus.current = true;
        setFocused(key);
        setLast(key);
    };
    const blur = (e: React.FocusEvent): void => {
        if (!root.current?.contains(e.relatedTarget as Node | null)) {
            ownsFocus.current = false;
            setFocused(null);
        }
    };
    const navigate = (e: React.KeyboardEvent, key: string): void => {
        const line = rows.findIndex((row) => row.includes(key));
        if (line < 0) {
            return;
        }
        const next = movePoint(
            rows.map((row) => row.length),
            { line, index: rows[line]!.indexOf(key) },
            e.key
        );
        if (next !== null) {
            e.preventDefault();
            nodes.current.get(rows[next.line]![next.index]!)?.focus();
        }
    };
    return { root, nodes, focused, tabbable, focus, blur, navigate };
}
