'use client';

import { CanvasEdge, CanvasNode } from '../app/canvas.tsx';
import { Sketch } from '../app/drawing.tsx';
import type { Rect } from '../app/edge-route.ts';
import { AssistantText } from '../app/chat.tsx';
import { Reveal } from '../app/primitives.tsx';
import { useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

// title, phone, api, db, arrows, circle, read, answer (held)
const STEPS = [600, 700, 700, 800, 800, 1000, 1300, 4600] as const;

const DRAWING: Rect = { x: 20, y: 16, w: 420, h: 236 };
const CHAT: Rect = { x: 170, y: 318, w: 450, h: 126 };

export function DrawingVignette() {
    return (
        <Stage
            width={640}
            height={460}
            label="A hand-drawn sketch of a phone, an API and a database, with the first call circled and marked cache this. A chat linked to the drawing reads it and proposes a cache."
        >
            <Drawing />
        </Stage>
    );
}

function Drawing() {
    const step = useTimeline(STEPS);
    return (
        <div className="absolute inset-0">
            <CanvasEdge from={DRAWING} to={CHAT} look="context" shown={step >= 6} />
            <CanvasNode rect={DRAWING} kind="drawing" title="Orders flow">
                <div className="canvas-dots absolute inset-0">
                    <Sketch step={step} scale={0.7} offset={[-22, -24]} />
                </div>
            </CanvasNode>
            <CanvasNode rect={CHAT} kind="chat" agent title="Orders" status={step >= 6 ? (step >= 7 ? 'idle' : 'running') : undefined} shown={step >= 6}>
                <div className="space-y-1.5 px-4 pt-3">
                    <Reveal shown={step >= 6} className="text-[13px] text-text-faint">
                        Read the drawing Orders flow
                    </Reveal>
                    <AssistantText shown={step >= 7} text="You circled the call from the phone to the API, so I'll cache the order list on the phone." />
                </div>
            </CanvasNode>
        </div>
    );
}
