'use client';

import {
    Circle,
    Diamond,
    Eraser,
    Hand,
    Hash,
    LockOpen,
    Maximize,
    Minus,
    MoreHorizontal,
    MousePointer2,
    MoveUpRight,
    Palette,
    Pencil,
    PenTool,
    Plus,
    Redo2,
    Square,
    StickyNote,
    Type,
    Undo2
} from 'lucide-react';
import { Sketch } from '../../app/drawing.tsx';
import { FLOAT } from '../../app/chrome.tsx';
import { IconButton, Separator } from '../../app/primitives.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';
import { GuideWindow } from './parts.tsx';

// title, phone, api, db, arrows, circle (held)
const STEPS = [500, 600, 600, 700, 700, 5200] as const;

/* `TOOLS` of `drawing/DrawingDock.tsx`, in its order, with Keep tool after them. */
const TOOLS = [MousePointer2, Hand, Square, Diamond, Circle, MoveUpRight, Minus, Pencil, Type, StickyNote, Eraser] as const;

/* A drawing view: the sketch on the dotted canvas and the drawing's own dock in place of the canvas dock. */
export function DrawingView() {
    return (
        <Stage
            width={1180}
            height={560}
            label="A drawing view named Orders flow. A hand-drawn phone, api and database with arrows between them, and the first call circled with cache this? beside it. At the bottom, the dock with the tools, the color and style, the zoom, and export, undo and redo."
        >
            <DrawingScene />
        </Stage>
    );
}

function DrawingScene() {
    const step = useTimeline(STEPS);

    return (
        <GuideWindow
            view={{ icon: PenTool, name: 'Orders flow' }}
            rows={[
                { id: 'checkout', name: 'Checkout', icon: Hash },
                { id: 'orders', name: 'Orders flow', icon: PenTool }
            ]}
            selected="orders"
        >
            <div className="canvas-dots absolute inset-0 overflow-hidden">
                <Sketch step={step} offset={[90, 24]} />
            </div>
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
                <div className={`flex items-center gap-2 rounded-xl p-1 ${FLOAT}`}>
                    <span className="inline-flex items-center gap-px">
                        {TOOLS.map((Tool, index) => (
                            <IconButton key={index} icon={Tool} active={index === 7} />
                        ))}
                        <IconButton icon={LockOpen} />
                    </span>
                    <Separator />
                    <span className="inline-flex items-center gap-px">
                        <span className="grid size-8 place-items-center">
                            {/* The stroke color `ink`, which the client's palette sets to the text color. */}
                            <span className="size-5 rounded-full border border-border-strong bg-text" />
                        </span>
                        <IconButton icon={Palette} />
                    </span>
                    <Separator />
                    <span className="inline-flex items-center gap-px">
                        <IconButton icon={Minus} />
                        <span className="flex h-8 min-w-14 items-center justify-center rounded-lg px-1 text-[13px] text-text-muted tabular-nums">100%</span>
                        <IconButton icon={Plus} />
                        <IconButton icon={Maximize} />
                    </span>
                    <Separator />
                    <span className="inline-flex items-center gap-px">
                        <IconButton icon={MoreHorizontal} />
                        <IconButton icon={Undo2} />
                        <IconButton icon={Redo2} />
                    </span>
                </div>
            </div>
        </GuideWindow>
    );
}
