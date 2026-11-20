'use client';

import { ArrowUpRight, ChevronRight, ChevronsUpDown, FileCode2, Hash, LoaderCircle } from 'lucide-react';
import { ClaudeMark } from '../../app/canvas.tsx';
import { AssistantText, Composer, UserBubble } from '../../app/chat.tsx';
import { AppWindow, Rail, Sidebar, TopRow } from '../../app/chrome.tsx';
import { Button, Reveal } from '../../app/primitives.tsx';
import { useTimeline } from '../../film/playback.ts';
import { Stage } from '../../film/Stage.tsx';

const STEPS = [1400, 2400, 2800, 4200] as const;

/* A chat asked for a design with `$design`: the design agent's card follows its pages, and ends on the one to look at first. */
export function DesignCard() {
    return (
        <Stage
            width={960}
            height={640}
            label="An AI chat as a view. The message asks for a design with $design. The chat answers that a design agent works on it, and its card shows a preview of the page it wrote. When it is done, the card reads Done, 2 pages, with a menu of the pages and Open design."
        >
            <DesignScene />
        </Stage>
    );
}

function DesignScene() {
    const step = useTimeline(STEPS);
    const done = step === 3;

    return (
        <div className="absolute inset-0">
            <AppWindow
                sidebar={
                    <Sidebar
                        waiting={[]}
                        rows={[
                            { id: 'checkout', name: 'Checkout', icon: Hash },
                            { id: 'chat', name: 'Notifications', icon: 'claude', status: done ? 'idle' : 'running', selected: true }
                        ]}
                    />
                }
                toolbar={<TopRow view={{ icon: 'claude', name: 'Notifications' }} />}
                rail={<Rail />}
            >
                <div className="absolute inset-0 flex flex-col bg-surface">
                    <div className="mx-auto flex min-h-0 w-full max-w-[560px] grow flex-col gap-3 overflow-hidden pt-6">
                        <UserBubble>
                            <span className="font-medium">$design</span> a settings page for notifications, and add the missing test for quiet hours.
                        </UserBubble>
                        <AssistantText shown={step >= 1} text="A design agent works on the settings page. Meanwhile I added the test for quiet hours." />
                        <Reveal shown={step >= 1}>
                            <TaskCard step={step} />
                        </Reveal>
                    </div>
                    <div className="mx-auto w-full max-w-[600px] px-4 pb-5">
                        <Composer />
                    </div>
                </div>
            </AppWindow>
        </div>
    );
}

// The card follows `design/DesignTaskCard.tsx`: the task's line, a 16:9 frame from the start, then the pages and Open design.
function TaskCard({ step }: { readonly step: number }) {
    const done = step === 3;
    const line = done ? 'Done · 2 pages' : step === 2 ? 'Wrote Notifications.html' : 'Running';

    return (
        <div className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface-raised">
            <div className="flex items-start gap-2 px-3 pt-2 pb-1">
                <span className="relative grid h-5 w-4 place-items-center text-text">
                    <ClaudeMark />
                    <span
                        className={`absolute -right-0.75 bottom-0 size-2 rounded-full ring-2 ring-surface ${done ? 'bg-status-idle' : 'bg-status-running'}`}
                    />
                </span>
                <span className="flex min-w-0 grow flex-col">
                    <span className="truncate text-[13px] leading-[19px] font-medium text-text">Opus 5.5: Notification settings</span>
                    <span className="truncate text-[12px] leading-4 text-text-muted">{line}</span>
                </span>
                <span className="flex h-5 items-center gap-2 text-[12px] text-text-faint tabular-nums">
                    {done ? '3m 12s' : null}
                    <ChevronRight size={12} strokeWidth={1.75} />
                </span>
            </div>
            <div className="px-3">
                <div className="relative aspect-video w-full overflow-hidden rounded-lg border border-border bg-surface-sunken">
                    {step >= 2 ? <PagePreview /> : <PagePlaceholder />}
                </div>
            </div>
            <div className="flex min-h-12 items-center gap-2 px-3 py-2.5">
                {step < 2 && <span className="text-[12px] text-text-faint">The design shows here once its first page is written.</span>}
                {step === 2 && (
                    <span className="flex items-center gap-1.5 text-[13px] text-text">
                        <LoaderCircle size={14} strokeWidth={1.75} className="animate-spin text-accent" />
                        Notifications
                    </span>
                )}
                {done && (
                    <span className="flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[13px] text-text">
                        <FileCode2 size={14} strokeWidth={1.75} className="text-text-muted" />
                        Notifications
                        <ChevronsUpDown size={14} strokeWidth={1.75} className="text-text-muted" />
                    </span>
                )}
                <span className="grow" />
                {step >= 2 && (
                    <Button variant="secondary">
                        <ArrowUpRight size={14} strokeWidth={1.75} /> Open design
                    </Button>
                )}
            </div>
        </div>
    );
}

// The card's own placeholder: a bar, a heading beside an image and a row of three, like no design on purpose.
function PagePlaceholder() {
    const block = 'block rounded-md bg-surface-active';

    return (
        <div className="absolute inset-0 flex flex-col gap-[6%] px-[5%] py-[4%]">
            <div className="flex items-center gap-3">
                <span className={`${block} h-2 w-[11%]`} />
                <span className="grow" />
                <span className={`${block} h-1.5 w-[5%]`} />
                <span className={`${block} h-1.5 w-[5%]`} />
            </div>
            <div className="flex min-h-0 grow gap-[4%]">
                <div className="flex w-[44%] flex-col justify-center gap-2">
                    <span className={`${block} h-4 w-[90%]`} />
                    <span className={`${block} h-4 w-[68%]`} />
                    <span className={`${block} mt-1 h-1.5 w-[82%]`} />
                </div>
                <span className={`${block} grow rounded-xl`} />
            </div>
            <div className="flex h-[16%] gap-3">
                <span className={`${block} grow rounded-lg`} />
                <span className={`${block} grow rounded-lg`} />
                <span className={`${block} grow rounded-lg`} />
            </div>
        </div>
    );
}

// A design paints its own look, so the page stays light whatever the window's appearance is.
function PagePreview() {
    const rows = ['Mentions', 'Direct messages', 'Weekly summary'];

    return (
        <div className="absolute inset-0 flex bg-[#f7f6f3] text-[#1d1c1a]">
            <div className="flex w-[24%] flex-col gap-2 border-r border-[#e4e2dc] px-4 py-5 text-[11px]">
                <span className="font-semibold">Settings</span>
                <span className="text-[#77736a]">Profile</span>
                <span className="rounded bg-[#e9e6df] px-1.5 py-0.5">Notifications</span>
                <span className="text-[#77736a]">Privacy</span>
            </div>
            <div className="flex grow flex-col gap-3 px-6 py-5">
                <span className="text-[15px] font-semibold">Notifications</span>
                {rows.map((row, i) => (
                    <div key={row} className="flex items-center justify-between rounded-lg border border-[#e4e2dc] bg-white px-3 py-2 text-[11px]">
                        {row}
                        <span className={`flex h-3.5 w-6 items-center rounded-full px-0.5 ${i === 2 ? 'bg-[#d6d3cb]' : 'justify-end bg-[#2f6f5e]'}`}>
                            <span className="size-2.5 rounded-full bg-white" />
                        </span>
                    </div>
                ))}
                <div className="flex items-center justify-between rounded-lg border border-[#e4e2dc] bg-white px-3 py-2 text-[11px]">
                    Quiet hours
                    <span className="text-[#77736a]">22:00 to 07:00</span>
                </div>
            </div>
        </div>
    );
}
