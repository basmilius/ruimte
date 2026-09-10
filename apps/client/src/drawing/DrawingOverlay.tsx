import { useEffect, useRef, useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { LINE_HEIGHT, NOTE_PADDING, RESIZE_HANDLES, boundsOfElements, handlePoint, writingFrameOf, type Rect, type WrittenElement } from '@ruimte/drawing';
import { fitTextBox } from '@/drawing/paint';
import { readFontStacks } from '@/drawing/palette';
import { isWritten, useDrawing } from '@/state/drawing';

/* The squares on a selection box, in screen pixels whatever the zoom is. */
const HANDLE = 8;

/* How far above the box the handle that turns the selection sits. */
const ROTATE_OFFSET = 24;

const CURSOR: Record<string, string> = {
    nw: 'nwse-resize',
    n: 'ns-resize',
    ne: 'nesw-resize',
    e: 'ew-resize',
    se: 'nwse-resize',
    s: 'ns-resize',
    sw: 'nesw-resize',
    w: 'ew-resize'
};

interface Camera {
    x: number;
    y: number;
    zoom: number;
}

const toScreen = (camera: Camera, x: number, y: number): { left: number; top: number } => ({
    left: x * camera.zoom + camera.x,
    top: y * camera.zoom + camera.y
});

/*
 * What sits above the two canvases: the selection with its handles, the marquee, and the text
 * being typed. It is DOM rather than paint, so handles stay whole pixels and the editor is a real
 * textarea with its own caret and undo.
 */
export function DrawingOverlay({ marquee }: { marquee: Rect | null }) {
    const camera = useDrawing(useShallow((s) => s.camera));
    const selection = useDrawing(useShallow((s) => s.selection));
    const elements = useDrawing((s) => s.elements);
    const editingTextId = useDrawing((s) => s.editingTextId);
    const selected = elements.filter((element) => selection.includes(element.id));
    const bounds = editingTextId ? null : boundsOfElements(selected);
    const single = selected.length === 1 ? selected[0]! : null;
    const editing = elements.find((element) => element.id === editingTextId);

    return (
        <div className="pointer-events-none absolute inset-0">
            {bounds && (
                <div
                    className="absolute border border-accent"
                    style={{
                        ...toScreen(camera, bounds.x, bounds.y),
                        width: bounds.w * camera.zoom,
                        height: bounds.h * camera.zoom,
                        // One element turns its box along with it; a group of them keeps an upright box.
                        transform: single?.angle ? `rotate(${single.angle}rad)` : undefined
                    }}
                >
                    {RESIZE_HANDLES.map((handle) => {
                        const point = handlePoint({ x: 0, y: 0, w: bounds.w * camera.zoom, h: bounds.h * camera.zoom }, handle);
                        return (
                            <span
                                key={handle}
                                data-handle={handle}
                                className="pointer-events-auto absolute rounded-sm border border-accent bg-surface-raised"
                                style={{ left: point.x - HANDLE / 2, top: point.y - HANDLE / 2, width: HANDLE, height: HANDLE, cursor: CURSOR[handle] }}
                            />
                        );
                    })}
                    {single && (
                        <span
                            data-handle="rotate"
                            className="pointer-events-auto absolute rounded-full border border-accent bg-surface-raised"
                            style={{
                                left: (bounds.w * camera.zoom) / 2 - HANDLE / 2,
                                top: -ROTATE_OFFSET,
                                width: HANDLE,
                                height: HANDLE,
                                cursor: 'grab'
                            }}
                        />
                    )}
                </div>
            )}
            {marquee && (
                <div className="absolute border border-accent bg-accent/10" style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }} />
            )}
            {editing && isWritten(editing) && <TextEditor element={editing} camera={camera} />}
        </div>
    );
}

/* The narrowest an empty editor gets, so the caret has a box to sit in. */
const EDITOR_MIN_WIDTH = 40;

/*
 * The text of one element while it is being typed, on the very spot the painter would write it. It
 * commits on blur, as a text on the canvas does. A note grows under the words as they are typed,
 * so the paper is never too small for what it says.
 */
function TextEditor({ element, camera }: { element: WrittenElement; camera: Camera }) {
    const ref = useRef<HTMLTextAreaElement>(null);
    const [box, setBox] = useState(() => fitTextBox(element));
    const note = element.kind === 'note';
    const frame = writingFrameOf(element);

    useEffect(() => {
        ref.current?.focus();
        ref.current?.select();
    }, []);

    const commit = (): void => {
        const value = ref.current?.value ?? '';
        const state = useDrawing.getState();
        if (value !== element.text) {
            state.updateText(element.id, value);
            if (note || value.trim() !== '') {
                // The box follows the glyphs, so a hit test and a selection frame the text itself.
                state.updateElement(element.id, fitTextBox(element, value), false);
            }
        }
        state.setEditingText(null);
    };

    const grow = (value: string): void => {
        const fitted = fitTextBox(element, value);
        setBox(fitted);
        if (note && fitted.h !== element.h) {
            useDrawing.getState().updateElement(element.id, fitted, false);
        }
    };

    return (
        <textarea
            ref={ref}
            defaultValue={element.text}
            spellCheck={false}
            className="pointer-events-auto absolute resize-none overflow-hidden border-none bg-transparent p-0 text-draw-ink outline-none"
            style={{
                ...toScreen(camera, element.x + frame.x, element.y + frame.y),
                width: (note ? frame.w : Math.max(box.w, EDITOR_MIN_WIDTH)) * camera.zoom,
                height: Math.max(note ? element.h - NOTE_PADDING * 2 : box.h, element.size) * camera.zoom,
                fontFamily: readFontStacks()[element.font ?? 'hand'],
                fontSize: element.size * camera.zoom,
                lineHeight: LINE_HEIGHT,
                color: `var(--draw-${element.stroke})`,
                textAlign: element.align ?? 'left',
                // A note and a sized box wrap as the painter does; a free text grows with its longest line.
                whiteSpace: note || element.sized ? 'pre-wrap' : 'pre',
                overflowWrap: note || element.sized ? 'anywhere' : 'normal'
            }}
            onBlur={commit}
            onInput={(e) => grow(e.currentTarget.value)}
            // The letters are tools out here; inside the editor they are letters.
            onKeyDown={(e) => {
                e.stopPropagation();
                if (e.key === 'Escape') {
                    e.preventDefault();
                    commit();
                }
            }}
        />
    );
}
