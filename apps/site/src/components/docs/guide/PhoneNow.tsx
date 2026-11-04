'use client';

import { CircleCheck, Clock, Folders, Hand, Inbox, type LucideIcon, MessageSquarePlus, Search, Server } from 'lucide-react';
import type { ReactNode } from 'react';
import { ClaudeMark, StatusDot } from '../../app/canvas.tsx';
import { AppIcon } from '../../AppIcon.tsx';
import { Stage } from '../../film/Stage.tsx';

/* `Navigation/PhoneHome.swift`: the five tabs and their Lucide icons. */
const TABS: readonly { readonly label: string; readonly icon: LucideIcon }[] = [
    { label: 'Now', icon: Inbox },
    { label: 'Projects', icon: Folders },
    { label: 'Routines', icon: Clock },
    { label: 'Machines', icon: Server },
    { label: 'Search', icon: Search }
];

const WORKING = [
    { title: 'Checkout speed', place: 'acme-web · studio' },
    { title: 'Full test suite', place: 'acme-web · build-box' }
] as const;

/*
 * The iPhone app: Now (`Now/NowPage.swift`) with a waiting chat answered on its card (`NowCard.swift`),
 * and beside it the lock screen with the notification of that chat.
 */
export function PhoneNow() {
    return (
        <Stage
            width={960}
            height={620}
            label="Two iPhones. One shows Now: under Needs you, the chat Saved carts asks to run bun test, with Deny and Allow on its card; under Working, two chats on other machines; the five tabs at the bottom. The other shows the lock screen with a notification from Ruimte: Saved carts, Run bun test."
        >
            <div className="absolute inset-0 flex items-center justify-center gap-16">
                <Phone>
                    <div className="flex items-end justify-between px-5 pt-3 pb-2">
                        <span className="text-[30px] leading-9 font-bold text-text">Now</span>
                        <MessageSquarePlus size={20} strokeWidth={1.75} className="mb-1.5 text-accent" />
                    </div>
                    <div className="flex min-h-0 grow flex-col gap-2 overflow-hidden px-4">
                        <Header title="Needs you" count={1} />
                        <div className="flex flex-col gap-2.5 rounded-2xl border border-border bg-surface p-3.5">
                            <div className="flex items-start gap-2.5">
                                <span className="mt-0.5 text-text-muted">
                                    <ClaudeMark size={16} />
                                </span>
                                <span className="flex min-w-0 flex-col">
                                    <span className="text-[15px] font-semibold text-text">Saved carts</span>
                                    <span className="text-xs text-text-muted">acme-web · 3 min</span>
                                </span>
                            </div>
                            <span className="flex items-center gap-1.5 text-sm font-medium text-text">
                                <Hand size={14} strokeWidth={1.75} className="text-status-needs-you" />
                                Run command
                            </span>
                            <div className="rounded-lg bg-surface-sunken px-2.5 py-2 font-mono text-xs text-text">bun test</div>
                            <div className="grid grid-cols-2 gap-2">
                                <span className="grid h-9 place-items-center rounded-full bg-surface-active text-sm font-medium text-text">Deny</span>
                                <span className="flex h-9 items-center justify-center gap-1.5 rounded-full bg-text text-sm font-medium text-bg">
                                    <CircleCheck size={14} strokeWidth={1.75} /> Allow
                                </span>
                            </div>
                        </div>
                        <div className="pt-4">
                            <Header title="Working" count={2} />
                        </div>
                        <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-surface">
                            {WORKING.map((row) => (
                                <div key={row.title} className="flex items-center gap-2.5 border-b border-border px-3.5 py-2.5 last:border-b-0">
                                    <StatusDot status="running" />
                                    <span className="flex min-w-0 flex-col">
                                        <span className="truncate text-sm text-text">{row.title}</span>
                                        <span className="truncate text-xs text-text-muted">{row.place}</span>
                                    </span>
                                </div>
                            ))}
                        </div>
                    </div>
                    {/* The search tab has the `search` role, which iOS draws as a round button of its own beside the bar. */}
                    <div className="mx-2 my-3 flex shrink-0 items-center gap-2">
                        <div className="flex min-w-0 grow items-center rounded-full border border-border bg-surface-raised px-1 py-1.5">
                            {TABS.slice(0, 4).map(({ label, icon: Icon }) => (
                                <span
                                    key={label}
                                    className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 text-xs ${label === 'Now' ? 'text-accent' : 'text-text-muted'}`}
                                >
                                    <Icon size={18} strokeWidth={1.75} />
                                    {label}
                                </span>
                            ))}
                        </div>
                        <span className="grid size-12 shrink-0 place-items-center rounded-full border border-border bg-surface-raised text-text-muted">
                            <Search size={18} strokeWidth={1.75} />
                        </span>
                    </div>
                </Phone>
                <Phone>
                    <div className="flex flex-col items-center pt-10 text-text">
                        <span className="text-sm font-medium text-text-muted">Monday 2 November</span>
                        <span className="text-[72px] leading-none font-semibold tracking-tight">9:41</span>
                    </div>
                    <div className="mx-3 mt-10 flex items-start gap-2.5 rounded-2xl border border-border bg-surface-raised p-3">
                        <AppIcon size={32} className="rounded-[8px]" />
                        <span className="flex min-w-0 grow flex-col">
                            <span className="flex items-baseline justify-between text-xs text-text-muted">
                                <span className="font-medium uppercase">Ruimte</span>
                                <span>now</span>
                            </span>
                            <span className="text-sm font-semibold text-text">Saved carts</span>
                            <span className="text-sm text-text">Run bun test</span>
                        </span>
                    </div>
                </Phone>
            </div>
        </Stage>
    );
}

function Phone({ children }: { readonly children: ReactNode }) {
    return (
        <div className="flex h-[580px] w-[324px] flex-col overflow-hidden rounded-[44px] border-[6px] border-surface-raised bg-bg shadow-[0_30px_80px_-10px_rgb(0_0_0/0.7)] outline outline-white/10">
            <div className="flex h-11 shrink-0 items-center justify-between px-7 text-xs font-semibold text-text">
                <span>9:41</span>
                <span className="h-6 w-20 rounded-full bg-black" />
                <span className="w-8" />
            </div>
            {children}
        </div>
    );
}

function Header({ title, count }: { readonly title: string; readonly count: number }) {
    return (
        <div className="flex items-baseline gap-1.5 px-1 text-sm font-semibold text-text">
            {title}
            <span className="font-normal text-text-muted tabular-nums">{count}</span>
        </div>
    );
}
