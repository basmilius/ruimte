'use client';

import type { ReactNode } from 'react';
import { FileText, Globe, LayoutGrid, Maximize2, MessageSquare, PenTool, Smartphone, StickyNote, Terminal, Workflow, X, type LucideIcon } from 'lucide-react';
import { motion } from 'motion/react';
import { siClaude } from 'simple-icons';
import { EASE } from '../film/playback.ts';
import { markerPath, type Rect, routeBetween } from './edge-route.ts';

export type NodeKind = 'terminal' | 'chat' | 'browser' | 'file' | 'drawing' | 'diagram' | 'note' | 'device' | 'group';
export type AgentStatus = 'running' | 'needs-you' | 'idle' | 'error' | 'exited';

const KIND_ICON: Record<NodeKind, LucideIcon> = {
    terminal: Terminal,
    chat: MessageSquare,
    browser: Globe,
    file: FileText,
    drawing: PenTool,
    diagram: Workflow,
    note: StickyNote,
    device: Smartphone,
    group: LayoutGrid
};

const STATUS_LABEL: Record<AgentStatus, string> = {
    running: 'Running',
    'needs-you': 'Needs you',
    idle: 'Idle',
    error: 'Error',
    exited: 'Session ended'
};

const STATUS_CLASS: Record<AgentStatus, string> = {
    running: 'bg-status-running',
    'needs-you': 'bg-status-needs-you',
    idle: 'bg-status-idle',
    error: 'bg-status-error',
    exited: 'bg-text-faint'
};

export function StatusDot({ status, className = '' }: { readonly status: AgentStatus; readonly className?: string }) {
    return (
        <span
            className={`inline-block size-2 shrink-0 rounded-full transition-colors duration-300 ${STATUS_CLASS[status]} ${status === 'running' ? 'status-pulse' : ''} ${className}`}
        />
    );
}

export function StatusPill({ status }: { readonly status: AgentStatus }) {
    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-[13px] leading-[19px] text-text-muted">
            <StatusDot status={status} />
            {STATUS_LABEL[status]}
        </span>
    );
}

/** The Claude mark a chat node shows in place of its kind icon (`agents/AgentIcon.tsx`). */
export function ClaudeMark({ size = 14, className = '' }: { readonly size?: number; readonly className?: string }) {
    return (
        <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className} aria-hidden>
            <path d={siClaude.path} />
        </svg>
    );
}

/**
 * A node as `canvas/NodeFrame.tsx` draws it: an 11px frame with a 39px raised header holding the
 * kind icon, the title, the status pill and the maximize and close buttons.
 */
export function CanvasNode({
    rect,
    kind,
    title,
    status,
    agent = false,
    selected = false,
    shown = true,
    delay = 0,
    className = '',
    children
}: {
    readonly rect: Rect;
    readonly kind: NodeKind;
    readonly title: ReactNode;
    readonly status?: AgentStatus;
    readonly agent?: boolean;
    readonly selected?: boolean;
    readonly shown?: boolean;
    readonly delay?: number;
    readonly className?: string;
    readonly children?: ReactNode;
}) {
    const Icon = KIND_ICON[kind];
    const group = kind === 'group';
    return (
        <motion.div
            className={`absolute isolate flex flex-col overflow-hidden rounded-xl border ${group ? 'border-dashed border-border-strong bg-[color-mix(in_srgb,var(--text-faint)_7%,transparent)]' : kind === 'note' ? 'border-border bg-note-yellow shadow-node' : 'border-border bg-surface shadow-node'} ${className}`}
            style={{
                left: rect.x,
                top: rect.y,
                width: rect.w,
                height: rect.h,
                outline: selected ? '2px solid var(--accent)' : '2px solid transparent',
                outlineOffset: 0
            }}
            initial={false}
            animate={{ opacity: shown ? 1 : 0, scale: shown ? 1 : 0.96 }}
            transition={{ duration: 0.4, ease: EASE, delay: shown ? delay : 0 }}
        >
            <div
                className={`flex h-[39px] shrink-0 items-center gap-2 pr-1 text-text-muted ${group ? 'pl-2.5' : kind === 'note' ? 'border-b border-[color-mix(in_srgb,var(--text)_12%,transparent)] pl-2.5' : 'border-b border-border bg-surface-raised pl-2.5'}`}
            >
                {agent ? <ClaudeMark /> : <Icon size={14} strokeWidth={1.75} />}
                <span className="min-w-0 grow truncate text-[13px] leading-[19px] font-medium text-text">{title}</span>
                {status && <StatusPill status={status} />}
                {!group && (
                    <span className="inline-flex items-center gap-px">
                        <span className="flex size-7 items-center justify-center rounded-md">
                            <Maximize2 size={14} strokeWidth={1.75} />
                        </span>
                        <span className="flex size-7 items-center justify-center rounded-md">
                            <X size={14} strokeWidth={1.75} />
                        </span>
                    </span>
                )}
            </div>
            <div className="relative min-h-0 grow">{children}</div>
        </motion.div>
    );
}

export type EdgeLook = 'context' | 'plain' | 'target' | 'task';

const LOOKS: Record<EdgeLook, { readonly tail?: 'dot'; readonly head: 'dot' | 'chevron'; readonly accent: boolean; readonly dashed: boolean }> = {
    context: { head: 'dot', accent: true, dashed: false },
    plain: { tail: 'dot', head: 'dot', accent: false, dashed: false },
    target: { head: 'chevron', accent: false, dashed: false },
    task: { head: 'dot', accent: true, dashed: true }
};

/**
 * A connector (`canvas/EdgeLayer.tsx`), drawn from its start the moment it is shown. The app draws it
 * in place; here it grows, since a line appearing is what the scene is about.
 */
export function CanvasEdge({
    from,
    to,
    look = 'context',
    shown = true,
    delay = 0,
    active = false
}: {
    readonly from: Rect;
    readonly to: Rect;
    readonly look?: EdgeLook;
    readonly shown?: boolean;
    readonly delay?: number;
    readonly active?: boolean;
}) {
    const route = routeBetween(from, to);
    const { tail, head, accent, dashed } = LOOKS[look];
    const color = accent ? (active ? 'var(--accent)' : 'var(--edge-context)') : active ? 'var(--text-muted)' : 'var(--edge-line)';
    const fade = { duration: 0.2, delay: shown ? delay + 0.5 : 0 };
    return (
        <svg className="pointer-events-none absolute top-0 left-0 overflow-visible" width={1} height={1} aria-hidden>
            <motion.path
                d={route.d}
                fill="none"
                stroke={color}
                strokeWidth={active ? 3 : 2}
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeDasharray={dashed ? '6 6' : undefined}
                initial={false}
                animate={{ pathLength: shown ? 1 : 0, opacity: shown ? 1 : 0 }}
                transition={{ duration: shown ? 0.6 : 0.2, ease: EASE, delay: shown ? delay : 0 }}
            />
            {tail && (
                <motion.path
                    d={markerPath(tail, route.start, route.startAlong)}
                    fill="var(--canvas-bg)"
                    stroke={color}
                    strokeWidth={2}
                    initial={false}
                    animate={{ opacity: shown ? 1 : 0 }}
                    transition={{ duration: 0.2, delay: shown ? delay : 0 }}
                />
            )}
            <motion.path
                d={markerPath(head, route.end, route.endAlong)}
                fill={head === 'dot' ? 'var(--canvas-bg)' : 'none'}
                stroke={color}
                strokeWidth={2}
                strokeLinecap="round"
                strokeLinejoin="round"
                initial={false}
                animate={{ opacity: shown ? 1 : 0 }}
                transition={fade}
            />
        </svg>
    );
}
