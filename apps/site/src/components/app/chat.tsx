'use client';

import type { ReactNode } from 'react';
import { ArrowUp, ChevronDown, ChevronLeft, ChevronRight, CircleCheck, Eye, Hand, Pencil, Plus, SquarePen, Terminal, type LucideIcon } from 'lucide-react';
import { StatusDot, type AgentStatus, ClaudeMark } from './canvas.tsx';
import { Button, IconButton, Typed } from './primitives.tsx';

export const TOOL_ICON = { read: Eye, edit: SquarePen, bash: Terminal } as const satisfies Record<string, LucideIcon>;

/** `rows/MessageRows.tsx`: the person's message, right-aligned on the active surface. */
export function UserBubble({ children }: { readonly children: ReactNode }) {
    return (
        <div className="flex flex-col items-end">
            <div className="max-w-[80%] rounded-2xl bg-surface-active px-3.5 py-2.5 text-[14px] leading-[21px] text-text">{children}</div>
        </div>
    );
}

/** A reply streams in whole words, without a bubble. */
export function AssistantText({ text, shown, className = '' }: { readonly text: string; readonly shown: boolean; readonly className?: string }) {
    if (!shown) {
        return null;
    }
    return (
        <div className={`text-[14px] leading-[21px] text-text ${className}`}>
            <Typed shown={shown} text={text} words speed={22} />
        </div>
    );
}

/** A collapsed tool call (`WorkRows.tsx` `ToggleLine`); `live` is the call still running. */
export function ToolRow({
    tool,
    label,
    detail,
    live = false
}: {
    readonly tool: keyof typeof TOOL_ICON;
    readonly label: string;
    readonly detail: string;
    readonly live?: boolean;
}) {
    const Icon = TOOL_ICON[tool];
    return (
        <div className="-mx-1 flex h-7 items-center gap-2 rounded-md px-1 text-[13px] leading-[19px] text-text-muted">
            <span className="grid h-5 w-4 place-items-center">
                <Icon size={12} strokeWidth={1.75} className={live ? 'text-accent' : ''} />
            </span>
            <span className={live ? 'shine' : ''}>{label}</span>
            <span className="truncate font-mono text-text-faint">{detail}</span>
            <span className="grow" />
            <ChevronRight size={12} strokeWidth={1.75} className="text-text-faint" />
        </div>
    );
}

export function WorkingRow({ seconds }: { readonly seconds: number }) {
    const time = `00:${String(seconds).padStart(2, '0')}`;
    return (
        <div className="flex items-center gap-2 text-[13px] leading-[19px]">
            <span className="size-2 rounded-full bg-status-running" />
            <span className="shine">Working for</span>
            <span className="text-text-faint tabular-nums">{time}</span>
        </div>
    );
}

/** The composer card and its controls row (`Composer.tsx`, `RunSettings.tsx`). */
export function Composer({ draft, typing = false }: { readonly draft?: string; readonly typing?: boolean }) {
    return (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-[color-mix(in_srgb,var(--surface-raised)_92%,transparent)] shadow-float backdrop-blur-[14px]">
            <div className="min-h-[45px] pt-[18px] pr-[14px] pb-[6px] pl-5 text-[14px] leading-[21px]">
                {draft ? (
                    <Typed shown text={draft} speed={typing ? 45 : 0} caret={typing} />
                ) : (
                    <span className="text-text-faint">
                        Ask anything, or <Kbd>/</Kbd> commands, <Kbd>@</Kbd> files, <Kbd>$</Kbd> skills
                    </span>
                )}
            </div>
            <div className="flex items-center gap-2 pt-3 pr-3.5 pb-3.5 pl-5">
                <span className="grid size-8 place-items-center rounded-full border border-border text-text-muted">
                    <Plus size={16} strokeWidth={1.75} />
                </span>
                <span className="flex h-8 items-center gap-2 rounded-full border border-border pr-3 pl-2.5 text-[13px] leading-[19px] text-text-muted">
                    <ClaudeMark />
                    <span className="font-medium text-text">Opus 5.5</span>
                    <span className="flex items-center gap-1">
                        <Pencil size={12} strokeWidth={1.75} /> Edits
                    </span>
                    <ChevronDown size={12} strokeWidth={1.75} />
                </span>
                <span className="grow" />
                <span className="flex h-9 items-center gap-0.5 rounded-full bg-surface-hover">
                    <span className="grid size-9 place-items-center rounded-full bg-accent text-white">
                        <ArrowUp size={16} strokeWidth={1.75} />
                    </span>
                </span>
            </div>
        </div>
    );
}

function Kbd({ children }: { readonly children: ReactNode }) {
    return <span className="rounded-[5px] bg-surface-active px-1.5 font-mono text-[13px] leading-5 text-text-muted">{children}</span>;
}

/** `PromptCard.tsx` for an approval: the command in its box, then Deny and the inverse Allow. */
export function ApprovalCard({ command, cwd, pressed = false }: { readonly command: string; readonly cwd: string; readonly pressed?: boolean }) {
    return (
        <div className="flex flex-col gap-2 p-3">
            <div className="flex items-start gap-2">
                <Hand size={16} strokeWidth={1.75} className="mt-[3px] text-status-needs-you" />
                <div>
                    <h3 className="text-[14px] leading-[21px] font-semibold text-text">Run command</h3>
                    <div className="text-[13px] leading-[19px] text-text-muted">1 request waiting</div>
                </div>
            </div>
            <div className="rounded-xl bg-surface-sunken p-3">
                <div className="font-mono text-[13px] leading-[19px] text-text-muted">{cwd}</div>
                <div className="font-mono text-[13px] leading-5 text-text">{command}</div>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
                <span className="ml-auto" />
                <Button>Always allow</Button>
                <Button>Deny</Button>
                <Button variant="inverse" className={pressed ? 'scale-[0.96]' : ''}>
                    <CircleCheck size={16} strokeWidth={1.75} /> Allow
                </Button>
            </div>
        </div>
    );
}

/** The stack of what waits on the person, above the dock (`PromptStack.tsx`). */
export function PromptStack({
    title,
    status,
    meta,
    children
}: {
    readonly title: string;
    readonly status: AgentStatus;
    readonly meta: string;
    readonly children: ReactNode;
}) {
    return (
        <div className="flex flex-col overflow-hidden rounded-2xl border border-border bg-[color-mix(in_srgb,var(--surface-raised)_92%,transparent)] shadow-float backdrop-blur-[14px]">
            <div className="flex items-center gap-2 border-b border-dashed border-border px-3 py-1.5 text-[13px] leading-[19px] text-text-muted">
                <StatusDot status={status} />
                <span className="font-medium text-text">{title}</span>
                <span>{meta}</span>
                <span className="grow" />
                <IconButton icon={ChevronLeft} size="xs" />
                <span className="tabular-nums">1 of 1</span>
                <IconButton icon={ChevronRight} size="xs" />
            </div>
            {children}
        </div>
    );
}
