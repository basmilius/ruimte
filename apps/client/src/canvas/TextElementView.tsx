import { memo, useEffect, useRef } from 'react';
import clsx from 'clsx';
import { useCanvas, useCanvasStore } from '@/state/canvas';

export const TextElementView = memo(function TextElementView({ id }: { id: string }) {
    const canvasStore = useCanvasStore();
    const text = useCanvas((s) => s.texts[id]);
    const selected = useCanvas((s) => s.selection.includes(id));
    const editing = useCanvas((s) => s.editingTextId === id);
    const hidden = useCanvas((s) => s.hidden.has(id));
    const ref = useRef<HTMLDivElement>(null);

    useEffect(() => {
        if (editing && ref.current) {
            ref.current.focus();
            const range = document.createRange();
            range.selectNodeContents(ref.current);
            range.collapse(false);
            window.getSelection()?.removeAllRanges();
            window.getSelection()?.addRange(range);
        }
    }, [editing]);

    if (!text || hidden) {
        return null;
    }

    const commit = (): void => {
        const value = ref.current?.innerText.trim() ?? '';
        canvasStore.getState().updateText(id, value);
        canvasStore.getState().setEditingText(null);
        if (value === '') {
            canvasStore.getState().select([id]);
            canvasStore.getState().deleteSelected();
        }
    };

    return (
        <div
            ref={ref}
            data-text-id={id}
            data-placeholder="Type something"
            className={clsx(
                'text-element absolute whitespace-pre rounded-sm px-1 py-0.5 leading-tight font-medium text-text',
                selected && !editing && 'outline-2 outline-(--selection)',
                !editing && 'cursor-default'
            )}
            style={{ left: text.x, top: text.y, fontSize: text.size }}
            contentEditable={editing ? 'plaintext-only' : false}
            suppressContentEditableWarning
            onDoubleClick={(e) => {
                e.stopPropagation();
                canvasStore.getState().setEditingText(id);
            }}
            onBlur={editing ? commit : undefined}
            onKeyDown={(e) => {
                if (editing && (e.key === 'Escape' || (e.key === 'Enter' && !e.shiftKey))) {
                    e.preventDefault();
                    ref.current?.blur();
                }
                if (editing) {
                    e.stopPropagation();
                }
            }}
        >
            {text.text}
            {selected && !editing && (
                <span
                    data-port={id}
                    contentEditable={false}
                    className="absolute -right-3 top-1/2 h-4 w-4 -translate-y-1/2 cursor-crosshair rounded-full border-2 border-accent bg-surface shadow-[0_0_0_2px_var(--surface)] hover:bg-accent"
                />
            )}
        </div>
    );
});
