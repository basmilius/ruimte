'use client';

import { CheckCheck, ChevronDown, Circle, CircleCheck, LoaderCircle, MoreHorizontal, X } from 'lucide-react';
import { AssistantText, ToolRow, UserBubble } from '../app/chat.tsx';
import { ClaudeMark, StatusDot } from '../app/canvas.tsx';
import { TrafficLights } from '../app/primitives.tsx';
import { useTimeline } from '../film/playback.ts';
import { Stage } from '../film/Stage.tsx';

const STEPS = [1600, 2000, 1800, 4400] as const;
const ITEMS = ['Preserve the cart', 'Restore the session', 'Add a regression test', 'Run checkout tests'];

export function PlanVignette() {
    return (
        <Stage
            width={640}
            height={430}
            label="A chat with its plan open beside it. The agent completes four checkout fixes, updating the active step and progress bar."
        >
            <PlanScene />
        </Stage>
    );
}

// Mirrors shell/PlanPanel.tsx and plan/PlanList.tsx, including row marks and the progress rail.
function PlanScene() {
    const step = useTimeline(STEPS);
    const done = step === 3 ? 4 : step + 1;
    return (
        <div className="absolute inset-x-5 top-6 bottom-6 flex flex-col overflow-hidden rounded-xl border border-border-strong bg-bg shadow-node">
            <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
                <TrafficLights />
                <span className="text-[13px] text-text-muted">acme-web</span>
            </div>
            <div className="flex min-h-0 grow">
                <div className="w-[252px] shrink-0 border-r border-border">
                    <div className="flex h-[39px] items-center gap-2 border-b border-border bg-surface-raised px-3 text-[13px]">
                        <ClaudeMark className="text-text-muted" />
                        <span className="grow">Fix checkout</span>
                        <StatusDot status={done === 4 ? 'idle' : 'running'} />
                    </div>
                    <div className="space-y-4 px-3 py-4">
                        <UserBubble>Fix checkout and cover it with a test.</UserBubble>
                        <ToolRow tool="edit" label="Updated" detail="session.ts" />
                        <AssistantText shown={done === 4} text="All four steps are done. Checkout now resumes with the cart intact, and the tests pass." />
                        {done < 4 && <div className="shine text-[13px]">{ITEMS[done]}</div>}
                    </div>
                </div>
                <div className="min-w-0 grow bg-surface">
                    <div className="flex h-[39px] items-center gap-3 border-b border-border px-3 text-[12px] text-text-muted">
                        <span className="grow font-medium">Fix checkout</span>
                        <MoreHorizontal size={16} />
                        <X size={16} />
                    </div>
                    <div className="space-y-1.5 border-b border-border px-4 py-3">
                        <div className="flex items-center gap-2 text-[15px] font-medium">
                            <CheckCheck size={16} className="text-text-muted" />
                            Reliable checkout
                        </div>
                        <p className="text-[13px] text-text-muted">Keep the cart through sign-in.</p>
                        <div className="flex gap-3 text-[13px] text-text-muted tabular-nums">
                            <span>Plan</span>
                            <span>{done}/4 done</span>
                        </div>
                        <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                            <span className="bg-status-idle transition-[width] duration-500 motion-reduce:transition-none" style={{ width: `${done * 25}%` }} />
                        </div>
                    </div>
                    <div className="py-2">
                        <div className="mx-1 flex items-center gap-1 px-2 py-1 text-[14px] font-medium">
                            <ChevronDown size={14} className="mr-1 text-text-faint" />
                            Implementation<span className="ml-auto text-[13px] font-normal text-text-muted tabular-nums">{done}/4</span>
                        </div>
                        {ITEMS.map((title, i) => {
                            const complete = i < done;
                            const active = i === done;
                            const Icon = complete ? CircleCheck : active ? LoaderCircle : Circle;
                            return (
                                <div key={title} className={`mx-1 flex items-center gap-1 rounded-md py-1 pr-2 pl-8 ${active ? 'bg-accent-soft' : ''}`}>
                                    <span className="grid size-5 shrink-0 place-items-center">
                                        <Icon
                                            size={14}
                                            strokeWidth={1.75}
                                            className={
                                                complete
                                                    ? 'text-status-idle'
                                                    : active
                                                      ? 'animate-spin text-accent motion-reduce:animate-none'
                                                      : 'text-text-faint'
                                            }
                                        />
                                    </span>
                                    <span className={`text-[14px] leading-[21px] ${complete ? 'text-text-muted' : 'text-text'}`}>{title}</span>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </div>
        </div>
    );
}
