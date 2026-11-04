'use client';

import { BrowserBody } from '../../app/bodies.tsx';
import { CanvasEdge, CanvasNode } from '../../app/canvas.tsx';
import { AssistantText, ToolRow, UserBubble } from '../../app/chat.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1400, 1800, 4200] as const;
const CHAT = { x: 24, y: 60, w: 330, h: 330 };
const BROWSER = { x: 420, y: 24, w: 300, h: 230 };
const DEVICE = { x: 760, y: 24, w: 176, h: 420 };

/* An agent with a target line to a browser and one to a simulator: it sends the page to an address and taps the device. */
export function BrowserDevice() {
    return (
        <Stage
            width={960}
            height={470}
            label="A chat with a line to a browser node and a line to an iPhone simulator. The agent opens the cart page in the browser, then taps Checkout on the simulator."
        >
            <BrowserDeviceScene />
        </Stage>
    );
}

function BrowserDeviceScene() {
    const step = useTimeline(STEPS);

    return (
        <div className="canvas-dots absolute inset-0 overflow-hidden rounded-xl border border-white/10">
            <CanvasEdge from={CHAT} to={BROWSER} look="target" />
            <CanvasEdge from={CHAT} to={DEVICE} look="target" />
            <CanvasNode rect={CHAT} kind="chat" agent title="Cart check" status={step === 2 ? 'idle' : 'running'}>
                <div className="flex flex-col gap-3 px-4 pt-4">
                    <UserBubble>Check the cart on the web and on the phone.</UserBubble>
                    <ToolRow tool="bash" label="Browser" detail="go Cart --url localhost:5173/cart" />
                    {step >= 1 && <ToolRow tool="bash" label="Device" detail="tap iPhone 17 --element 12" live={step === 1} />}
                    <AssistantText shown={step === 2} text="Both show the saved cart, and Checkout opens on the phone." />
                </div>
            </CanvasNode>
            <CanvasNode rect={BROWSER} kind="browser" title="Cart">
                <BrowserBody url="localhost:5173/cart" loading={step === 0}>
                    <div className="space-y-2.5 bg-white p-4 text-[12px] text-[#18181b]">
                        <div className="text-[16px] font-semibold">Your cart</div>
                        <div className="flex justify-between border-b border-[#e4e4e7] pb-2">
                            <span>Walking shoes</span>
                            <span>€89</span>
                        </div>
                        <div className="h-7 rounded-md bg-[#18181b] text-center leading-7 font-medium text-white">Checkout</div>
                    </div>
                </BrowserBody>
            </CanvasNode>
            <CanvasNode rect={DEVICE} kind="device" title="iPhone 17">
                <div className="absolute inset-0 grid place-items-center bg-surface-sunken p-3">
                    <div className="relative flex h-full w-full flex-col overflow-hidden rounded-[22px] bg-white text-[11px] text-[#18181b]">
                        <div className="px-3 pt-3 text-[9px] font-semibold">9:41</div>
                        <div className="px-3 pt-3 text-[15px] font-semibold">Cart</div>
                        <div className="mx-3 mt-2 flex justify-between border-b border-[#e4e4e7] pb-1.5">
                            <span>Walking shoes</span>
                            <span>€89</span>
                        </div>
                        <span className="grow" />
                        <div className="m-3 h-8 rounded-lg bg-[#18181b] text-center leading-8 font-medium text-white">{step >= 1 ? 'Paying…' : 'Checkout'}</div>
                    </div>
                </div>
            </CanvasNode>
        </div>
    );
}
