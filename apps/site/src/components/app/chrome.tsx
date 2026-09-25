'use client';

import type { ReactNode } from 'react';
import {
    ChartNoAxesColumn,
    ChevronDown,
    CircleCheck,
    Folder,
    GitBranch,
    LayoutTemplate,
    LockOpen,
    Maximize,
    Minus,
    PanelLeftClose,
    Plus,
    Search,
    Settings,
    TabletSmartphone,
    Laptop,
    X,
    type LucideIcon
} from 'lucide-react';
import { AnimatePresence, motion } from 'motion/react';
import { EASE } from '../film/playback.ts';
import { type AgentStatus, ClaudeMark, StatusDot } from './canvas.tsx';
import { Button, IconButton, ProjectGlyph, Separator, TrafficLights } from './primitives.tsx';

export interface SidebarRow {
    readonly id: string;
    readonly name: string;
    /** A Lucide glyph, or the Claude mark for a chat or terminal that runs it. */
    readonly icon: LucideIcon | 'claude';
    /** A node listed under its expanded canvas. */
    readonly nested?: boolean;
    readonly status?: AgentStatus;
    readonly done?: boolean;
    readonly selected?: boolean;
    /** Open in another cell of the grid. */
    readonly beside?: boolean;
}

export function RowIcon({ icon: Icon }: { readonly icon: SidebarRow['icon'] }) {
    return <span className="grid size-4 shrink-0 place-items-center">{Icon === 'claude' ? <ClaudeMark /> : <Icon size={14} strokeWidth={1.75} />}</span>;
}

function Row({ row }: { readonly row: SidebarRow }) {
    const tone = row.selected ? 'bg-surface-active text-text' : row.beside ? 'text-text' : 'text-text-muted';
    return (
        <motion.div
            layout="position"
            className={`flex h-8 w-full items-center gap-2 rounded-md px-2 text-[14px] leading-[21px] transition-colors duration-200 ${row.nested ? 'pl-6' : 'font-medium'} ${tone}`}
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.3, ease: EASE }}
        >
            <RowIcon icon={row.icon} />
            <span className="min-w-0 truncate">{row.name}</span>
            <span className="grow" />
            {row.done && <CircleCheck size={12} strokeWidth={1.75} className="text-status-idle" />}
            {row.status && <StatusDot status={row.status} />}
        </motion.div>
    );
}

/** `shell/Sidebar.tsx`: the wordmark past the traffic lights, what waits on you, then the views. */
export function Sidebar({ waiting, rows }: { readonly waiting: readonly SidebarRow[]; readonly rows: readonly (SidebarRow | 'separator')[] }) {
    return (
        <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-surface">
            <div className="relative flex h-12 shrink-0 items-center justify-between pr-2 pl-[92px]">
                <TrafficLights className="absolute top-[18px] left-[17px]" />
                <span className="inline-flex h-6 items-center font-brand text-[13px] font-semibold tracking-[0.2em] text-text-faint">RUIMTE</span>
                <IconButton icon={PanelLeftClose} />
            </div>
            <div className="mt-2 min-h-0 grow overflow-hidden px-2">
                <AnimatePresence initial={false}>
                    {waiting.length > 0 && (
                        <motion.div
                            key="waiting"
                            className="mb-3 flex flex-col gap-px"
                            initial={{ opacity: 0, height: 0 }}
                            animate={{ opacity: 1, height: 'auto' }}
                            exit={{ opacity: 0, height: 0 }}
                            transition={{ duration: 0.35, ease: EASE }}
                        >
                            <div className="flex items-center gap-1.5 px-2 py-1 text-[13px] font-medium text-text-faint">
                                <StatusDot status="needs-you" />
                                Needs you
                                <span className="ml-auto tabular-nums">{waiting.length}</span>
                            </div>
                            {waiting.map((row) => (
                                <Row key={row.id} row={row} />
                            ))}
                        </motion.div>
                    )}
                </AnimatePresence>
                <motion.div layout="position" className="flex flex-col gap-px" transition={{ duration: 0.35, ease: EASE }}>
                    <AnimatePresence initial={false}>
                        {rows.map((row, i) =>
                            row === 'separator' ? (
                                <div key={`separator-${i}`} className="flex h-6 items-center">
                                    <span className="-mx-2 h-px grow bg-border-soft" />
                                </div>
                            ) : (
                                <Row key={row.id} row={row} />
                            )
                        )}
                    </AnimatePresence>
                </motion.div>
            </div>
            <div className="flex items-center gap-1 border-t border-border p-2">
                <span className="flex h-8 grow items-center gap-2 rounded-md px-2 text-[14px] text-text-muted">
                    <Plus size={14} strokeWidth={1.75} /> View
                </span>
                <span className="flex h-8 w-5 items-center justify-center">
                    <span className="size-2 rounded-full bg-status-idle" />
                </span>
                <IconButton icon={ChartNoAxesColumn} />
                <IconButton icon={Settings} />
            </div>
        </aside>
    );
}

/** `shell/Toolbar.tsx`: the project menu, then the panel toggles and search. */
export function Toolbar({ project = 'acme-web', panel }: { readonly project?: string; readonly panel?: 'git' | 'files' }) {
    return (
        <div className="flex h-12 shrink-0 items-center gap-2 border-b border-border bg-surface pr-2 pl-2 text-[13px] text-text-muted">
            <span className="flex h-8 items-center gap-2 rounded-md px-2">
                <Laptop size={14} strokeWidth={1.75} />
                <ProjectGlyph letter="A" color="#f54900" />
                <span className="text-[14px] font-medium text-text">{project}</span>
                <ChevronDown size={14} strokeWidth={1.75} />
            </span>
            <span className="grow" />
            <Separator />
            <span className="inline-flex items-center gap-px">
                <IconButton icon={Folder} active={panel === 'files'} />
                <IconButton icon={GitBranch} active={panel === 'git'} />
                <IconButton icon={TabletSmartphone} />
            </span>
            <Separator />
            <IconButton icon={Search} />
        </div>
    );
}

const FLOAT = 'border border-border bg-[color-mix(in_srgb,var(--surface-raised)_88%,transparent)] shadow-float backdrop-blur-[14px]';

/** The dock of a canvas view: what waits and works, add, zoom and lock. */
export function Dock({ waiting = 0, working = 0, finished = 0 }: { readonly waiting?: number; readonly working?: number; readonly finished?: number }) {
    const counts = waiting + working + finished > 0;
    return (
        <div className={`flex items-center gap-2 rounded-xl p-1 ${FLOAT}`}>
            {counts && (
                <>
                    {waiting > 0 && (
                        <Button size="md" className="gap-1.5 text-text">
                            <StatusDot status="needs-you" />
                            <span className="tabular-nums">{waiting}</span>
                        </Button>
                    )}
                    {working > 0 && (
                        <span className="flex h-8 items-center gap-1.5 px-3 text-[13px] font-medium text-text-muted tabular-nums">
                            <StatusDot status="running" />
                            {working}
                        </span>
                    )}
                    {finished > 0 && (
                        <span className="flex h-8 items-center gap-1.5 px-3 text-[13px] font-medium text-text-muted tabular-nums">
                            <CircleCheck size={12} strokeWidth={1.75} className="text-status-idle" />
                            {finished}
                        </span>
                    )}
                    <Separator />
                </>
            )}
            <IconButton icon={Plus} />
            <Separator />
            <span className="inline-flex items-center gap-px">
                <IconButton icon={Minus} />
                <span className="flex h-8 min-w-14 items-center justify-center rounded-lg px-1 text-[13px] text-text-muted tabular-nums">100%</span>
                <IconButton icon={Plus} />
                <IconButton icon={Maximize} />
            </span>
            <Separator />
            <span className="inline-flex items-center gap-px">
                <IconButton icon={LockOpen} />
                <IconButton icon={LayoutTemplate} />
            </span>
        </div>
    );
}

/** The bar above a cell once the grid holds more than one (`CellToolbar.tsx`). */
export function CellToolbar({
    icon,
    name,
    focused,
    children
}: {
    readonly icon: SidebarRow['icon'];
    readonly name: string;
    readonly focused: boolean;
    readonly children?: ReactNode;
}) {
    return (
        <div
            className={`flex h-10 shrink-0 items-center gap-2 overflow-hidden border-b border-border pr-1.5 pl-2 text-[13px] transition-colors duration-300 ${focused ? 'bg-surface text-text' : 'bg-[#0e0e10] text-text-muted'}`}
        >
            <span className="flex min-w-0 items-center gap-2 pl-1">
                <RowIcon icon={icon} />
                <span className="truncate font-medium">{name}</span>
            </span>
            <span className="grow" />
            {children}
            <IconButton icon={X} size="sm" />
        </div>
    );
}

/**
 * The desktop window around it all: the sidebar, the toolbar above the view and whatever floats over
 * the view (the dock, the prompt stack).
 */
export function AppWindow({ sidebar, toolbar, children }: { readonly sidebar: ReactNode; readonly toolbar: ReactNode; readonly children: ReactNode }) {
    return (
        <div className="flex h-full w-full overflow-hidden rounded-[12px] border border-white/10 bg-bg text-[14px] text-text shadow-[0_40px_120px_-20px_rgb(0_0_0/0.8),0_0_0_1px_rgb(0_0_0/0.6)]">
            {sidebar}
            <main className="flex min-w-0 grow flex-col">
                {toolbar}
                <div className="relative min-h-0 grow">{children}</div>
            </main>
        </div>
    );
}
