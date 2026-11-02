import type { CSSProperties, ReactNode } from 'react';
import clsx from 'clsx';

export type MockStatus = 'running' | 'needs-you' | 'idle' | 'error' | 'exited' | 'delegating';
export type MockKind = 'canvas' | 'terminal' | 'chat' | 'browser' | 'note' | 'file' | 'device' | 'drawing' | 'group';
export type MockLineLook = 'context' | 'task' | 'target' | 'origin';

/* The words of `canvas.status.*` in the client. */
const STATUS_LABEL: Record<MockStatus, string> = {
    running: 'Running',
    'needs-you': 'Needs you',
    idle: 'Idle',
    error: 'Error',
    exited: 'Session ended',
    delegating: 'Sub-agents working'
};

const STATUS_DOT: Record<MockStatus, string> = {
    running: 'bg-status-running',
    'needs-you': 'bg-status-needs-you',
    idle: 'bg-status-idle',
    error: 'bg-status-error',
    exited: 'bg-text-faint',
    delegating: 'bg-status-running'
};

export function StatusDot({ status, pulse = status === 'running' }: { readonly status: MockStatus; readonly pulse?: boolean }) {
    return <span className={clsx('inline-block size-2 shrink-0 rounded-full', STATUS_DOT[status], pulse && 'mock-pulse')} />;
}

export function StatusPill({ status, pulse }: { readonly status: MockStatus; readonly pulse?: boolean }) {
    return (
        <span className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-surface-sunken px-2 py-0.5 text-2xs text-text-muted">
            <StatusDot status={status} pulse={pulse} />
            {STATUS_LABEL[status]}
        </span>
    );
}

/* A small mark per kind of node, drawn here so the mockups need no icon set. */
export function KindMark({ kind }: { readonly kind: MockKind }) {
    const shapes: Record<MockKind, ReactNode> = {
        terminal: <path d="M3 4.5l3 2.5-3 2.5M7.5 11h5" />,
        chat: <path d="M2.5 3.5h11v7h-6l-3 2.5v-2.5h-2z" />,
        browser: (
            <>
                <circle cx="8" cy="8" r="5.5" />
                <path d="M2.5 8h11M8 2.5c2 2 2 9 0 11M8 2.5c-2 2-2 9 0 11" />
            </>
        ),
        note: <path d="M3.5 2.5h9v11h-9zM5.5 6h5M5.5 8.5h5M5.5 11h3" />,
        file: <path d="M4 2.5h5l3 3v8H4zM9 2.5v3h3" />,
        device: <path d="M5 2h6v12H5zM7.25 12h1.5" />,
        drawing: <path d="M3 13l1-3 7-7 2 2-7 7zM9.5 4.5l2 2" />,
        canvas: <path d="M2.5 2.5h4.5v4.5h-4.5zM9 2.5h4.5v4.5h-4.5zM2.5 9h4.5v4.5h-4.5zM9 9h4.5v4.5h-4.5z" />,
        group: <path d="M2.5 2.5h11v11h-11z" strokeDasharray="2 2" />
    };

    return (
        <svg viewBox="0 0 16 16" width={14} height={14} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round">
            {shapes[kind]}
        </svg>
    );
}

/* A node as the canvas draws it: a rounded frame with a raised header holding its mark, title and status. */
export function MockNode({
    x,
    y,
    w,
    h,
    kind,
    title,
    status,
    pulse,
    badge,
    selected = false,
    className,
    style,
    children
}: {
    readonly x: number;
    readonly y: number;
    readonly w: number;
    readonly h: number;
    readonly kind: MockKind;
    readonly title: string;
    readonly status?: MockStatus;
    readonly pulse?: boolean;

    /* Stands in the header after the status pill, such as a status that changes. */
    readonly badge?: ReactNode;

    readonly selected?: boolean;
    readonly className?: string;
    readonly style?: CSSProperties;
    readonly children?: ReactNode;
}) {
    if (kind === 'group') {
        return (
            <div
                className={clsx('absolute rounded-xl border border-dashed border-border-strong bg-text/3', className)}
                style={{ left: x, top: y, width: w, height: h, ...style }}
            >
                <span className="absolute top-2 left-3 text-2xs font-medium text-text-muted">{title}</span>
                {children}
            </div>
        );
    }

    return (
        <div
            className={clsx(
                'absolute flex flex-col overflow-hidden rounded-xl border bg-surface bg-clip-padding shadow-lg',
                selected ? 'border-accent' : 'border-border',
                className
            )}
            style={{ left: x, top: y, width: w, height: h, ...style }}
        >
            <div className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-surface-raised px-2.5 text-text-muted">
                <KindMark kind={kind} />
                <span className="min-w-0 grow truncate text-2xs font-medium text-text">{title}</span>
                {status !== undefined && <StatusPill status={status} pulse={pulse} />}
                {badge}
            </div>
            <div className="relative min-h-0 grow">{children}</div>
        </div>
    );
}

const LINE_LOOKS: Record<MockLineLook, { readonly stroke: string; readonly marker?: string; readonly dashed: boolean }> = {
    context: { stroke: 'stroke-accent', marker: 'url(#mock-dot)', dashed: false },
    task: { stroke: 'stroke-accent', marker: 'url(#mock-dot)', dashed: true },
    target: { stroke: 'stroke-text-muted', marker: 'url(#mock-chevron)', dashed: false },
    origin: { stroke: 'stroke-text-muted', marker: 'url(#mock-chevron)', dashed: true }
};

/*
 * A line between two nodes, in the look the canvas gives its purpose (`canvas/edge-look.ts` in the client):
 * a context line in the accent with a dot where the agent reads, dashed while a task over it is open; a
 * target line in the neutral with its point at the page or device being worked; and an origin line, the
 * target's shape dashed, which only says where a node came from.
 */
export function MockLine({
    d,
    look,
    draw
}: {
    readonly d: string;
    readonly look: MockLineLook;

    /* Draws the line once, after `delay` seconds. A marker would stand at the end before the line gets there, so a drawn context line puts its dot at `end` once it arrives. */
    readonly draw?: { readonly delay: number; readonly end?: readonly [number, number] };
}) {
    const { stroke, marker, dashed } = LINE_LOOKS[look];

    return (
        <>
            <path
                d={d}
                fill="none"
                className={clsx(stroke, draw !== undefined && 'mock-draw')}
                strokeWidth={2}
                strokeDasharray={dashed ? '6 5' : undefined}
                strokeLinecap="round"
                markerEnd={draw === undefined ? marker : undefined}
                style={draw === undefined ? undefined : { animationDelay: `${draw.delay}s` }}
            />
            {draw?.end !== undefined && (
                <circle cx={draw.end[0]} cy={draw.end[1]} r={4} className="mock-appear fill-accent" style={{ animationDelay: `${draw.delay + 1.1}s` }} />
            )}
        </>
    );
}

/* The layer the lines of a mockup sit in, under its nodes, with the markers their ends use. */
export function MockLines({ width, height, children }: { readonly width: number; readonly height: number; readonly children: ReactNode }) {
    return (
        <svg className="absolute inset-0" width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
            <defs>
                <marker id="mock-dot" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="5" markerHeight="5">
                    <circle cx="5" cy="5" r="4" className="fill-accent" />
                </marker>
                <marker id="mock-chevron" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="7" markerHeight="7" orient="auto">
                    <path d="M1 1l7 4-7 4" fill="none" className="stroke-text-muted" strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
                </marker>
            </defs>
            {children}
        </svg>
    );
}

/* The window around a mockup of the whole app: a top row with the project, then whatever it holds. */
export function MockWindow({ project, children }: { readonly project: string; readonly children: ReactNode }) {
    return (
        <div className="flex size-full flex-col bg-bg">
            <div className="flex h-10 shrink-0 items-center gap-3 border-b border-border px-4">
                <span className="flex gap-1.5">
                    <span className="size-2.5 rounded-full bg-text/15" />
                    <span className="size-2.5 rounded-full bg-text/15" />
                    <span className="size-2.5 rounded-full bg-text/15" />
                </span>
                <span className="inline-flex size-4 items-center justify-center rounded-sm bg-accent/20 text-2xs font-semibold text-accent">
                    {project.charAt(0)}
                </span>
                <span className="text-xs font-medium text-text">{project}</span>
            </div>
            <div className="flex min-h-0 grow">{children}</div>
        </div>
    );
}

/* A row of the sidebar: a view with its kind and, for a terminal or chat, the status of its agent. */
export function SidebarRow({
    kind,
    title,
    status,
    active = false,
    pulse
}: {
    readonly kind: MockKind;
    readonly title: string;
    readonly status?: MockStatus;
    readonly active?: boolean;
    readonly pulse?: boolean;
}) {
    return (
        <div className={clsx('flex h-7 items-center gap-2 rounded-md px-2 text-xs', active ? 'bg-surface-active text-text' : 'text-text-muted')}>
            <KindMark kind={kind} />
            <span className="min-w-0 grow truncate">{title}</span>
            {status !== undefined && <StatusDot status={status} pulse={pulse} />}
        </div>
    );
}

export function SidebarLabel({ children }: { readonly children: ReactNode }) {
    return <div className="mt-3 mb-1 px-2 text-2xs font-medium tracking-wide text-text-faint uppercase">{children}</div>;
}
