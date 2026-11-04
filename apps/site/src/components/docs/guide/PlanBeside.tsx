'use client';

import { CheckCheck, ChevronDown, Circle, CircleCheck, Hash, LoaderCircle, MoreHorizontal, StickyNote, X } from 'lucide-react';
import { AssistantText, Composer, ToolRow, UserBubble, WorkingRow } from '../../app/chat.tsx';
import { AppWindow, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1800, 1800, 1800, 4200] as const;
const ITEMS = ['Add a carts table', 'Save the cart on every change', 'Restore the cart after sign-in', 'Expire carts after 30 days'];

/* A chat view with its plan in the side panel: the agent works down the steps, and one step carries a note you left. */
export function PlanBeside() {
    return (
        <Stage
            width={1080}
            height={580}
            label="A chat with its plan open in the panel at the right. The agent checks off four steps one by one. The second step carries a note you left: also save on sign-out."
        >
            <PlanScene />
        </Stage>
    );
}

// The panel follows shell/PlanPanel.tsx: its header, the plan's title and progress, then the steps of a section.
function PlanScene() {
    const step = useTimeline(STEPS);
    const done = step === 3 ? 4 : step + 1;

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={[]}
                        rows={[
                            { id: 'checkout', name: 'Checkout', icon: Hash },
                            { id: 'chat', name: 'Saved carts', icon: 'claude', status: done === 4 ? 'idle' : 'running', selected: true }
                        ]}
                    />
                }
                toolbar={<TopRow view={{ icon: 'claude', name: 'Saved carts' }} />}
                rail={<Rail />}
                sidePanel={
                    <aside className="flex w-[290px] shrink-0 flex-col">
                        <div className="flex h-[47px] items-center gap-3 border-b border-border px-3 text-[13px] text-text-muted">
                            <span className="grow font-medium">Saved carts</span>
                            <MoreHorizontal size={16} />
                            <X size={16} />
                        </div>
                        <div className="space-y-1.5 border-b border-border px-4 py-3">
                            <div className="flex items-center gap-2 text-[15px] font-medium">
                                <CheckCheck size={16} className="text-text-muted" />
                                Saved carts
                            </div>
                            <div className="flex gap-3 text-[13px] text-text-muted tabular-nums">
                                <span>Plan</span>
                                <span>{done}/4 done</span>
                            </div>
                            <div className="mt-2 flex h-1.5 overflow-hidden rounded-full bg-surface-sunken">
                                <span
                                    className="bg-status-idle transition-[width] duration-500 motion-reduce:transition-none"
                                    style={{ width: `${done * 25}%` }}
                                />
                            </div>
                        </div>
                        <div className="py-2">
                            <div className="mx-1 flex items-center gap-1 px-2 py-1 text-[14px] font-medium">
                                <ChevronDown size={14} className="mr-1 text-text-faint" />
                                Steps<span className="ml-auto text-[13px] font-normal text-text-muted tabular-nums">{done}/4</span>
                            </div>
                            {ITEMS.map((title, i) => {
                                const complete = i < done;
                                const active = i === done;
                                const Icon = complete ? CircleCheck : active ? LoaderCircle : Circle;

                                return (
                                    <div key={title} className={`mx-1 rounded-md py-1 pr-2 pl-8 ${active ? 'bg-accent-soft' : ''}`}>
                                        <div className="flex items-center gap-1">
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
                                        {i === 1 && (
                                            <div className="mt-0.5 ml-6 flex items-center gap-1.5 text-[13px] text-text-muted">
                                                <StickyNote size={12} strokeWidth={1.75} />
                                                Also save on sign-out
                                            </div>
                                        )}
                                    </div>
                                );
                            })}
                        </div>
                    </aside>
                }
            >
                <div className="absolute inset-0 flex flex-col bg-surface">
                    <div className="mx-auto flex min-h-0 w-full max-w-[400px] grow flex-col gap-3 overflow-hidden pt-6">
                        <UserBubble>Build saved carts. Make a plan first.</UserBubble>
                        <ToolRow tool="edit" label="Edit" detail="src/cart.ts" live={done < 4} />
                        <AssistantText shown={done === 4} text="All four steps are done, including the save on sign-out from your note." />
                        {done < 4 && <WorkingRow seconds={done * 11 + 4} />}
                    </div>
                    <div className="mx-auto w-full max-w-[440px] px-4 pb-5">
                        <Composer />
                    </div>
                </div>
            </AppWindow>
        </div>
    );
}
