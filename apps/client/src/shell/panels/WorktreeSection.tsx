import { Menu } from '@base-ui-components/react/menu';
import { Eye, FolderX, GitBranch, LocateFixed, MoreHorizontal, Trash } from 'lucide-react';
import type { CanvasNodeKind, Worktree } from '@ruimte/contracts';
import { StatusDot } from '@/canvas/NodeFrame';
import { nodesInWorktree, workCounts } from '@/shell/panels/worktree-rows';
import { nodeWorking } from '@/state/agent-work';
import { useChats } from '@/state/chats';
import { useEndpointId } from '@/state/keys';
import { useSessions } from '@/state/sessions';
import { MENU_SEPARATOR, SECTION_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/Pill';
import { Tooltip } from '@/ui/Tooltip';

export interface WorktreeNode {
    id: string;
    kind: CanvasNodeKind;
    title: string;
    cwd?: string;
}

interface WorktreeSectionProps {
    worktrees: readonly Worktree[];
    /* Every node of the project, on every canvas, so a row can name the node working in it. */
    nodes: readonly WorktreeNode[];
    /* The checkout the panel is on, so its row reads as picked. */
    current: string | null;
    busy: boolean;
    onView(worktree: Worktree): void;
    onRemove(worktree: Worktree): void;
    onReveal(nodeId: string): void;
}

/*
 * The worktrees of the project's repository, each with the node that works in it and the work it
 * holds. It is the one place a worktree whose node is gone still shows up, which is what an agent
 * team leaves behind once its canvas is cleaned up.
 */
export function WorktreeSection({ worktrees, nodes, current, busy, onView, onRemove, onReveal }: WorktreeSectionProps) {
    const endpointId = useEndpointId();
    const sessions = useSessions((s) => s.byKey);
    const chats = useChats((s) => s.byKey);

    if (worktrees.length === 0) {
        return null;
    }

    return (
        <section className="flex max-h-48 shrink-0 flex-col border-t border-border">
            <div className="flex h-8 shrink-0 items-center gap-2 px-3">
                <span className={SECTION_LABEL}>Worktrees</span>
                <span className="text-xs text-text-faint tabular-nums">{worktrees.length}</span>
            </div>
            <ul className="min-h-0 overflow-y-auto pb-1">
                {worktrees.map((worktree) => {
                    const working = nodesInWorktree(nodes, worktree);
                    const names = working.map((node) => node.title || node.kind).join(', ');
                    const agentWorking = working.some((node) => nodeWorking(node, sessions, chats, endpointId));
                    const counts = worktree.work ? workCounts(worktree.work) : [];
                    const reveal = working[0]?.id ?? null;
                    return (
                        <li
                            key={worktree.path}
                            className="group flex h-8 items-center gap-2 pr-1 pl-3 hover:bg-surface-hover"
                            aria-current={worktree.path === current ? 'true' : undefined}
                        >
                            <Icon icon={worktree.missing ? FolderX : GitBranch} size={14} className="shrink-0 text-text-muted" />
                            <Tooltip label={worktree.path}>
                                <button
                                    className="min-w-0 shrink truncate text-left font-mono text-sm text-text hover:underline disabled:no-underline"
                                    disabled={worktree.missing === true}
                                    onClick={() => onView(worktree)}
                                >
                                    {worktree.branch}
                                </button>
                            </Tooltip>
                            {agentWorking && <StatusDot status="running" />}
                            <span className="min-w-0 shrink-[2] truncate text-xs text-text-faint">
                                {worktree.missing ? 'folder missing' : names === '' ? 'no node' : names}
                                {worktree.from?.branch !== undefined && `, from ${worktree.from.branch}`}
                            </span>
                            <span className="grow" />
                            {counts.map((label) => (
                                <Pill key={label} className="tabular-nums">
                                    {label}
                                </Pill>
                            ))}
                            <Menu.Root>
                                <Tooltip label="Worktree actions" name>
                                    <Menu.Trigger className="icon-btn h-7 w-7 shrink-0" disabled={busy}>
                                        <Icon icon={MoreHorizontal} size={14} />
                                    </Menu.Trigger>
                                </Tooltip>
                                <Menu.Portal>
                                    <Menu.Positioner className="z-(--z-popup)" side="bottom" align="end" sideOffset={6}>
                                        <Menu.Popup className="menu-popup">
                                            {!worktree.missing && (
                                                <Menu.Item className="menu-item" onClick={() => onView(worktree)}>
                                                    <Icon icon={Eye} size={14} /> View
                                                </Menu.Item>
                                            )}
                                            {reveal !== null && (
                                                <Menu.Item className="menu-item" onClick={() => onReveal(reveal)}>
                                                    <Icon icon={LocateFixed} size={14} /> Show on the canvas
                                                </Menu.Item>
                                            )}
                                            {(!worktree.missing || reveal !== null) && <Menu.Separator className={MENU_SEPARATOR} />}
                                            <Menu.Item className="menu-item text-status-error" onClick={() => onRemove(worktree)}>
                                                <Icon icon={Trash} size={14} /> Remove...
                                            </Menu.Item>
                                        </Menu.Popup>
                                    </Menu.Positioner>
                                </Menu.Portal>
                            </Menu.Root>
                        </li>
                    );
                })}
            </ul>
        </section>
    );
}
