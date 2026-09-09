import { ChevronDown, Globe, MessageSquare, Plus, Search, Settings, Terminal } from 'lucide-react';
import clsx from 'clsx';
import { useShallow } from 'zustand/react/shallow';
import { demoProjects } from '@/data/demo';
import { useCanvas, type AgentStatus, type CanvasNode } from '@/state/canvas';
import { StatusDot } from '@/canvas/NodeFrame';
import { ConnectionDot } from '@/shell/ConnectionDot';

const KIND_ICON = {
    terminal: Terminal,
    chat: MessageSquare,
    browser: Globe
} as const;

const GROUPS: { status: AgentStatus | 'none'; label: string }[] = [
    { status: 'needs-you', label: 'Needs you' },
    { status: 'running', label: 'Running' },
    { status: 'idle', label: 'Idle' },
    { status: 'none', label: 'Other' }
];

function SessionRow({ node }: { node: CanvasNode }) {
    const selected = useCanvas((s) => s.selection.includes(node.id));
    const Icon = KIND_ICON[node.kind];
    return (
        <button
            className={clsx(
                'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-[13px] transition-colors',
                selected ? 'bg-accent-soft text-text' : 'text-text-muted hover:bg-surface-sunken hover:text-text'
            )}
            onClick={() => useCanvas.getState().goToNode(node.id)}
        >
            <Icon size={14} strokeWidth={1.75} className="shrink-0" />
            <span className="truncate">{node.title}</span>
            <span className="grow" />
            {node.status && <StatusDot status={node.status} />}
        </button>
    );
}

export function Sidebar() {
    const nodes = useCanvas(useShallow((s) => s.order.map((id) => s.nodes[id])));
    const active = demoProjects.find((p) => p.active) ?? demoProjects[0];

    return (
        <aside className="flex h-full w-[248px] shrink-0 flex-col border-r border-border bg-surface">
            <div className="flex h-12 items-center gap-2 px-3">
                <span className="grid h-6 w-6 place-items-center rounded-md bg-accent text-[12px] font-semibold text-accent-text">R</span>
                <span className="text-[14px] font-semibold tracking-tight text-text">Ruimte</span>
                <span className="grow" />
                <button className="icon-btn h-7 w-7" title="Search"><Search size={15} /></button>
            </div>

            <div className="px-2">
                <button className="flex w-full items-center gap-2 rounded-lg border border-border bg-surface-raised px-2.5 py-2 text-left hover:bg-surface-sunken">
                    <span className="h-3 w-3 rounded-sm" style={{ background: active.color }} />
                    <span className="truncate text-[13px] font-medium text-text">{active.name}</span>
                    <span className="grow" />
                    <ChevronDown size={14} className="text-text-muted" />
                </button>
            </div>

            <div className="mt-4 min-h-0 grow overflow-auto px-2">
                {GROUPS.map((group) => {
                    const rows = nodes.filter((n) => (group.status === 'none' ? !n.status : n.status === group.status));
                    if (rows.length === 0) {
                        return null;
                    }
                    return (
                        <div key={group.status} className="mb-3">
                            <div className="flex items-center gap-1.5 px-2 py-1 text-[11px] font-medium uppercase tracking-[.04em] text-text-faint">
                                {group.status !== 'none' && <StatusDot status={group.status} />}
                                {group.label}
                                <span className="ml-auto tabular-nums">{rows.length}</span>
                            </div>
                            {rows.map((n) => <SessionRow key={n.id} node={n} />)}
                        </div>
                    );
                })}
            </div>

            <div className="flex items-center gap-1 border-t border-border p-2">
                <button className="flex h-8 grow items-center gap-2 rounded-md px-2 text-[13px] text-text-muted hover:bg-surface-sunken hover:text-text">
                    <Plus size={15} /> New session
                </button>
                <ConnectionDot />
                <button className="icon-btn" title="Settings"><Settings size={15} /></button>
            </div>
        </aside>
    );
}
