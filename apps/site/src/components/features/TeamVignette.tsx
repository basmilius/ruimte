'use client';

import { CircleCheck, LoaderCircle } from 'lucide-react';
import { CanvasEdge, CanvasNode } from '../app/canvas.tsx';
import { AssistantText, ToolRow, UserBubble } from '../app/chat.tsx';
import { useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

const STEPS = [1800, 2200, 2200, 5000] as const;
const LEAD = { x: 20, y: 94, w: 292, h: 280 };
const TASKS = [
    { title: 'Trace requests', rect: { x: 366, y: 22, w: 254, h: 182 }, tool: 'checkout.trace', result: 'Shipping is requested once per item.', doneAt: 2 },
    { title: 'Check queries', rect: { x: 366, y: 270, w: 254, h: 168 }, tool: 'queries.log', result: 'The same cart is loaded 12 times.', doneAt: 3 }
] as const;

export function TeamVignette() {
    return (
        <Stage
            width={640}
            height={460}
            label="An agent investigates a slow checkout with two other agents. One traces requests, the other checks database queries, and their findings return to the lead agent."
        >
            <TeamScene />
        </Stage>
    );
}

// NodeFrame, EdgeLayer and tasks/TaskMark define the task connections and completion marks.
function TeamScene() {
    const step = useTimeline(STEPS);
    return (
        <div className="absolute inset-0">
            {TASKS.map((task) => (
                <CanvasEdge key={task.title} from={LEAD} to={task.rect} look={step >= task.doneAt ? 'context' : 'task'} />
            ))}
            <CanvasNode rect={LEAD} kind="chat" agent title="Speed up checkout" status={step === 3 ? 'idle' : 'running'}>
                <div className="space-y-3 px-4 py-3">
                    <UserBubble>Checkout takes 4 seconds. Find out why.</UserBubble>
                    <ToolRow tool="bash" label="Started" detail="2 agents" />
                    <AssistantText shown={step === 3} text="Both agents found repeated work. Load the cart once and batch the shipping request." />
                    {step < 3 && (
                        <p className="text-[13px] leading-[19px] text-text-muted">One agent is tracing requests. Another is checking database queries.</p>
                    )}
                </div>
            </CanvasNode>
            {TASKS.map((task) => {
                const done = step >= task.doneAt;
                const Mark = done ? CircleCheck : LoaderCircle;
                return (
                    <CanvasNode key={task.title} rect={task.rect} kind="chat" agent title={task.title}>
                        <div className="space-y-2 px-3 py-3">
                            <ToolRow tool="read" label={done ? 'Read' : 'Reading'} detail={task.tool} live={!done} />
                            <p className="min-h-[42px] text-[14px] leading-[21px]">
                                {done
                                    ? task.result
                                    : task.title === 'Trace requests'
                                      ? 'Following a 12-item cart through checkout.'
                                      : 'Counting queries for the same checkout.'}
                            </p>
                            <div className={`flex items-center gap-1.5 text-[13px] ${done ? 'text-status-idle' : 'text-text-muted'}`}>
                                <Mark size={12} strokeWidth={1.75} className={done ? '' : 'animate-spin motion-reduce:animate-none'} />
                                {done ? 'Done' : 'Working'}
                            </div>
                        </div>
                    </CanvasNode>
                );
            })}
        </div>
    );
}
