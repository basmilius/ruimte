'use client';

import { CanvasEdge, CanvasNode } from '../app/canvas.tsx';
import { TerminalBody } from '../app/bodies.tsx';
import { AssistantText, ToolRow } from '../app/chat.tsx';
import { useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

const STEPS = [1400, 1800, 4800] as const;
const NOTE = { x: 24, y: 26, w: 256, h: 152 };
const TERMINAL = { x: 328, y: 26, w: 288, h: 152 };
const CHAT = { x: 110, y: 242, w: 420, h: 160 };

export function ContextVignette() {
    return (
        <Stage width={640} height={430} label="A brief and a failing test linked to a chat. The agent reads both and fixes the expired checkout session.">
            <ContextScene />
        </Stage>
    );
}

// NodeFrame, NoteNode and EdgeLayer in apps/client define these frames and context links.
function ContextScene() {
    const step = useTimeline(STEPS);
    return (
        <div className="absolute inset-0">
            <CanvasEdge from={NOTE} to={CHAT} shown={step >= 1} />
            <CanvasEdge from={TERMINAL} to={CHAT} shown={step >= 1} delay={0.2} />
            <CanvasNode rect={NOTE} kind="note" title="Checkout brief">
                <div className="px-3 py-2.5 text-[14px] leading-[21px]">
                    <p className="font-semibold">Keep the cart intact.</p>
                    <p className="mt-2">If a session expires, ask the customer to sign in and resume checkout.</p>
                </div>
            </CanvasNode>
            <CanvasNode rect={TERMINAL} kind="terminal" title="checkout tests">
                <TerminalBody>
                    <div className="text-term-dim">$ bun test checkout</div>
                    <div className="mt-2 text-ansi-red">✗ expired session</div>
                    <div> Expected: cart preserved</div>
                    <div className="text-term-dim"> Received: empty cart</div>
                </TerminalBody>
            </CanvasNode>
            <CanvasNode rect={CHAT} kind="chat" agent title="Fix checkout" status={step === 2 ? 'idle' : 'running'}>
                <div className="space-y-2 px-4 py-3">
                    <ToolRow tool="read" label="Read linked context" detail="2 sources" live={step === 1} />
                    <AssistantText
                        shown={step === 2}
                        text="The reset clears the cart as well as the session. I'll keep the cart and restore checkout after sign-in."
                    />
                </div>
            </CanvasNode>
        </div>
    );
}
