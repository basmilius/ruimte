'use client';

import { CircleCheck, GitBranch, LoaderCircle } from 'lucide-react';
import { CanvasEdge, CanvasNode } from '../../app/canvas.tsx';
import { AssistantText, ToolRow, UserBubble } from '../../app/chat.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1600, 2200, 2400, 4600] as const;
const LEAD = { x: 24, y: 110, w: 300, h: 280 };
const TASKS = [
    {
        title: 'Query analysis',
        rect: { x: 404, y: 24, w: 300, h: 190 },
        reading: 'Counting queries for one checkout.',
        result: 'The cart loads 12 times. Load it once.',
        doneAt: 2,
        branch: null
    },
    {
        title: 'Request tracing',
        rect: { x: 404, y: 270, w: 300, h: 190 },
        reading: 'Timing each step of POST /checkout.',
        result: 'Shipping is asked once per item. Batch it.',
        doneAt: 3,
        branch: 'trace-checkout'
    }
] as const;

/* A chat hands two tasks to agents it opened. Each line is dashed while its task is open, and the parent wakes once both are done. */
export function Delegation() {
    return (
        <Stage
            width={728}
            height={484}
            label="A chat opened two agents and gave each a task. A dashed line runs from the chat into each child while its task is open, and turns solid when it is done. One child works in a worktree on its own branch. When both are done, the chat combines their results."
        >
            <DelegationScene />
        </Stage>
    );
}

function DelegationScene() {
    const step = useTimeline(STEPS);

    return (
        <div className="canvas-dots absolute inset-0 overflow-hidden rounded-xl border border-white/10">
            {TASKS.map((task) => (
                <CanvasEdge key={task.title} from={LEAD} to={task.rect} look={step >= task.doneAt ? 'context' : 'task'} shown={step >= 1} />
            ))}
            <CanvasNode rect={LEAD} kind="chat" agent title="Slow checkout" status={step === 3 ? 'idle' : 'running'}>
                <div className="space-y-3 px-4 py-3">
                    <UserBubble>Checkout takes 4 seconds. Find out why.</UserBubble>
                    <ToolRow tool="bash" label="Team" detail="--label Slow checkout --roles … --task" />
                    <AssistantText shown={step === 3} text="Load the cart once and batch the shipping request. Both agents found the same waste." />
                </div>
            </CanvasNode>
            {TASKS.map((task) => {
                const done = step >= task.doneAt;
                const Mark = done ? CircleCheck : LoaderCircle;

                return (
                    <CanvasNode key={task.title} rect={task.rect} kind="chat" agent title={task.title} shown={step >= 1} status={done ? 'idle' : 'running'}>
                        <div className="space-y-2 px-3 py-3">
                            <p className="min-h-[42px] text-[14px] leading-[21px]">{done ? task.result : task.reading}</p>
                            <div className="flex items-center gap-3 text-[13px]">
                                <span className={`flex items-center gap-1.5 ${done ? 'text-status-idle' : 'text-text-muted'}`}>
                                    <Mark size={12} strokeWidth={1.75} className={done ? '' : 'animate-spin motion-reduce:animate-none'} />
                                    {done ? 'Done' : 'Running'}
                                </span>
                                {task.branch !== null && (
                                    <span className="flex items-center gap-1 rounded-md bg-surface-sunken px-1.5 py-0.5 font-mono text-[12px] text-text-muted">
                                        <GitBranch size={12} strokeWidth={1.75} />
                                        {task.branch}
                                    </span>
                                )}
                            </div>
                        </div>
                    </CanvasNode>
                );
            })}
        </div>
    );
}
