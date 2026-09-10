import { useEffect, useMemo, useRef } from 'react';
import { browserRegistry, useBrowser } from '@/browser/registry';
import { GROUP_HEADER_PX, isNodeFocused, useCanvas } from '@/state/canvas';

// The browser toolbar sits under the frame's header, both above the page.
const TOOLBAR_PX = 37;

function WebviewSlot({ nodeId, shield }: { nodeId: string; shield: boolean }) {
    const node = useCanvas((s) => s.nodes[nodeId]);
    const focused = useCanvas((s) => isNodeFocused(s.mode, nodeId));
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const host = ref.current;
        const element = browserRegistry.get(nodeId);
        if (host && element && element.parentElement !== host) {
            host.appendChild(element);
        }
    }, [nodeId]);

    // A node that is not on this canvas keeps its page, out of sight; a hidden guest is not thrown away.
    const visible = node !== undefined && node.kind === 'browser';
    return (
        <div
            ref={ref}
            className="absolute overflow-hidden"
            style={{
                left: node?.x ?? 0,
                top: (node?.y ?? 0) + GROUP_HEADER_PX + TOOLBAR_PX,
                width: node?.w ?? 1,
                height: Math.max(1, (node?.h ?? 1) - GROUP_HEADER_PX - TOOLBAR_PX),
                visibility: visible ? 'visible' : 'hidden',
                // Only a focused node hands the pointer to its page, and never while the canvas is mid-gesture.
                pointerEvents: visible && focused && !shield ? 'auto' : 'none'
            }}
        />
    );
}

/* Every browser page, positioned over its node in the same world space; nodes below stay put. */
export function WebviewLayer({ shield }: { shield: boolean }) {
    // Selecting the object and deriving the keys: a selector that builds an array loops forever.
    const byNodeId = useBrowser((s) => s.byNodeId);
    const ids = useMemo(() => Object.keys(byNodeId), [byNodeId]);
    if (ids.length === 0) {
        return null;
    }
    return (
        <>
            {ids.map((nodeId) => (
                <WebviewSlot key={nodeId} nodeId={nodeId} shield={shield} />
            ))}
        </>
    );
}
