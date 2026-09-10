import type { AgentStatus } from '@/state/canvas';

/* The order the sidebar lists its groups in: what waits for you first, what is done last. */
const GROUP_ORDER: { status: AgentStatus | 'none'; label: string }[] = [
    { status: 'needs-you', label: 'Needs you' },
    { status: 'running', label: 'Running' },
    { status: 'idle', label: 'Idle' },
    { status: 'none', label: 'Other' }
];

export interface SidebarGroup<T> {
    status: AgentStatus | 'none';
    label: string;
    rows: T[];
}

/* The rows per group, empty groups left out. The status comes in as a function so this stays a
   pure list operation: the arrow keys below are tested without a store or a daemon. */
export const groupRows = <T>(rows: T[], statusOf: (row: T) => AgentStatus | null): SidebarGroup<T>[] =>
    GROUP_ORDER.map((group) => ({
        ...group,
        rows: rows.filter((row) => {
            const status = statusOf(row);
            return group.status === 'none' ? status === null : status === group.status;
        })
    })).filter((group) => group.rows.length > 0);

/* The ids in the order the eye reads them, which is the order Up and Down have to walk. */
export const rowOrder = <T extends { id: string }>(groups: SidebarGroup<T>[]): string[] => groups.flatMap((group) => group.rows.map((row) => row.id));

/* The row an arrow key lands on. Without a row to move from, Down starts at the top and Up at the
   bottom; at either end it stays put, so a held key never wraps around behind your back. */
export const rowAfterArrow = (order: string[], current: string | null, delta: -1 | 1): string | null => {
    if (order.length === 0) {
        return null;
    }
    const at = current === null ? -1 : order.indexOf(current);
    if (at === -1) {
        return delta === 1 ? order[0]! : order[order.length - 1]!;
    }
    return order[Math.min(order.length - 1, Math.max(0, at + delta))] ?? null;
};
