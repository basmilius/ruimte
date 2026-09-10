import { useEffect, useRef } from 'react';
import { Markdown } from '@/chat/ui/Markdown';
import { useCanvas } from '@/state/canvas';

/*
 * A sticky note: rendered markdown on the canvas, a textarea while the node has focus. The text
 * is saved with the project and, linked into an agent, read by it as a text source.
 */
export function NoteNode({ id, focused }: { id: string; focused: boolean }) {
    const body = useCanvas((s) => s.nodes[id]?.body ?? '');
    const ref = useRef<HTMLTextAreaElement>(null);

    useEffect(() => {
        if (focused && ref.current) {
            const el = ref.current;
            el.focus();
            el.setSelectionRange(el.value.length, el.value.length);
        }
    }, [focused]);

    if (focused) {
        return (
            <textarea
                ref={ref}
                value={body}
                placeholder="Write a note. Markdown works."
                spellCheck={false}
                className="h-full w-full resize-none bg-transparent px-3 py-2.5 font-sans text-sm leading-normal text-text outline-none placeholder:text-text-faint"
                onChange={(e) => useCanvas.getState().updateNode(id, { body: e.target.value })}
            />
        );
    }

    if (body.trim() === '') {
        // An empty note has nothing to read, so the first click may as well put the cursor in it.
        return (
            <button
                className="h-full w-full cursor-text px-3 py-2.5 text-left text-sm text-text-faint"
                onPointerDown={(e) => e.stopPropagation()}
                onClick={() => useCanvas.getState().enterNode(id)}
            >
                Click to write
            </button>
        );
    }

    return <div className="h-full overflow-auto px-3 py-2.5 select-text">{<Markdown text={body} />}</div>;
}
