'use client';

import { Pill } from '@adecore/ui';
import { Server } from 'lucide-react';
import { TerminalBody } from '../../app/bodies.tsx';
import { CanvasEdge, CanvasNode } from '../../app/canvas.tsx';
import { AssistantText, ToolRow, UserBubble } from '../../app/chat.tsx';
import { Dock } from '../../app/chrome.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1800, 4200] as const;
const CHAT = { x: 24, y: 40, w: 330, h: 340 };
const REMOTE_CHAT = { x: 410, y: 24, w: 400, h: 230 };
const REMOTE_TERMINAL = { x: 410, y: 290, w: 400, h: 150 };

/* The pill `MachinePill` in `canvas/NodeFrame.tsx` puts in the header of a node on another machine. */
function MachinePill() {
    return (
        <Pill icon={<Server size={12} strokeWidth={1.75} />} className="max-w-40">
            build-box
        </Pill>
    );
}

/* A chat on this machine gives a task to a chat on another one; the nodes there carry its name. */
export function RemoteNode() {
    return (
        <Stage
            width={960}
            height={500}
            label="A canvas on the laptop. A chat here has a task line to a chat on build-box, and a terminal on build-box runs the tests. Both nodes on build-box show a pill with its name."
        >
            <RemoteNodeScene />
        </Stage>
    );
}

function RemoteNodeScene() {
    const step = useTimeline(STEPS);

    return (
        <div className="canvas-dots absolute inset-0 overflow-hidden rounded-xl border border-white/10">
            <CanvasEdge from={CHAT} to={REMOTE_CHAT} look="task" />
            <CanvasNode rect={CHAT} kind="chat" agent title="Saved carts" status="idle">
                <div className="flex flex-col gap-3 px-4 pt-4">
                    <UserBubble>Run the full test suite on build-box, it is faster there.</UserBubble>
                    <ToolRow tool="bash" label="Agent" detail="claude --machine build-box --task --prompt …" />
                    <AssistantText shown text="The tests run on build-box. I pick up the result when it is done." />
                </div>
            </CanvasNode>
            <CanvasNode rect={REMOTE_CHAT} kind="chat" agent title="Full test suite" status={step === 0 ? 'running' : 'idle'} actions={<MachinePill />}>
                <div className="flex flex-col gap-3 px-4 pt-4">
                    <ToolRow tool="bash" label="Bash" detail="bun test" live={step === 0} />
                    <AssistantText shown={step === 1} text="All 312 tests pass. The branch is ready to bring back." />
                </div>
            </CanvasNode>
            <CanvasNode rect={REMOTE_TERMINAL} kind="terminal" title="tests" actions={<MachinePill />}>
                <TerminalBody>
                    <div>
                        <span className="text-term-dim">$</span> bun test
                    </div>
                    <div> </div>
                    <div>{step === 0 ? <span className="text-term-dim">running 312 tests…</span> : <span className="text-ansi-green">312 pass</span>}</div>
                </TerminalBody>
            </CanvasNode>
            <div className="absolute inset-x-0 bottom-4 flex justify-center">
                <Dock working={step === 0 ? 1 : 0} />
            </div>
        </div>
    );
}
