'use client';

import { BrowserBody, TerminalBody } from '../../app/bodies.tsx';
import { CanvasEdge, CanvasNode } from '../../app/canvas.tsx';
import { AssistantText, ToolRow, UserBubble } from '../../app/chat.tsx';
import { Dock } from '../../app/chrome.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1400, 1400, 1800, 4200] as const;
const GROUP = { x: 20, y: 20, w: 248, h: 404 };
const NOTE = { x: 36, y: 60, w: 216, h: 132 };
const TERMINAL = { x: 36, y: 222, w: 216, h: 182 };
const CHAT = { x: 318, y: 40, w: 300, h: 360 };
const BROWSER = { x: 666, y: 80, w: 270, h: 280 };

/* Lines arrive one at a time: two context lines into the chat, then a target line from the chat to the page it drives. */
export function Canvas() {
    return (
        <Stage
            width={960}
            height={500}
            label="A canvas. A group holds a note and a terminal. A context line runs from each into a chat, so the agent reads both. Then a target line runs from the chat to a browser, which the agent drives."
        >
            <CanvasScene />
        </Stage>
    );
}

function CanvasScene() {
    const step = useTimeline(STEPS);

    return (
        <div className="canvas-dots absolute inset-0 overflow-hidden rounded-xl border border-white/10">
            <CanvasEdge from={NOTE} to={CHAT} look="context" shown={step >= 1} />
            <CanvasEdge from={TERMINAL} to={CHAT} look="context" shown={step >= 2} />
            <CanvasEdge from={CHAT} to={BROWSER} look="target" shown={step >= 3} />
            <CanvasNode rect={GROUP} kind="group" title="Context" />
            <CanvasNode rect={NOTE} kind="note" title="Brief">
                <div className="px-3 py-2.5 text-[14px] leading-[21px] text-text">An expired cart must not break checkout.</div>
            </CanvasNode>
            <CanvasNode rect={TERMINAL} kind="terminal" title="tests">
                <TerminalBody>
                    <div>
                        <span className="text-term-dim">$</span> bun test
                    </div>
                    <div> </div>
                    <div>
                        <span className="text-ansi-green">48 pass</span>
                    </div>
                    <div>
                        <span className="text-ansi-red">2 fail</span>
                    </div>
                    <div className="text-term-dim">cart.test.ts: expired cart</div>
                </TerminalBody>
            </CanvasNode>
            <CanvasNode rect={CHAT} kind="chat" agent title="Fix the cart" status={step === 3 ? 'running' : 'idle'} selected={step >= 1}>
                <div className="flex flex-col gap-3 px-4 pt-4">
                    <UserBubble>Fix the two failing tests, then check the cart page.</UserBubble>
                    {step >= 2 && <ToolRow tool="read" label="Read" detail="tests" />}
                    <AssistantText shown={step === 3} text="Both fail on an expired cart. Fixed, and opening the cart page to check it." />
                </div>
            </CanvasNode>
            <CanvasNode rect={BROWSER} kind="browser" title="Cart" shown={step >= 3}>
                <BrowserBody url="localhost:5173/cart" loading={step === 3}>
                    <div className="space-y-2.5 bg-white p-4 text-[12px] text-[#18181b]">
                        <div className="text-[16px] font-semibold">Your cart</div>
                        <div className="flex justify-between border-b border-[#e4e4e7] pb-2">
                            <span>Walking shoes</span>
                            <span>€89</span>
                        </div>
                        <div className="flex justify-between border-b border-[#e4e4e7] pb-2">
                            <span>Socks, 3 pairs</span>
                            <span>€15</span>
                        </div>
                        <div className="h-7 rounded-md bg-[#18181b] text-center leading-7 font-medium text-white">Checkout</div>
                    </div>
                </BrowserBody>
            </CanvasNode>
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
                <Dock working={step === 3 ? 1 : 0} />
            </div>
        </div>
    );
}
