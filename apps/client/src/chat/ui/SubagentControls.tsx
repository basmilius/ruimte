import { Fragment } from 'react';
import clsx from 'clsx';
import { Menu } from '@base-ui-components/react/menu';
import { Bot, ChevronRight, ListChecks, X } from 'lucide-react';
import type { ChatSubagentItem } from '@ruimte/contracts';
import { breadcrumbOf, crumbOf, openFromMain, trailTo, useOpenableSubagents, useSubagentTrail } from '@/chat/subagent-view';
import { MENU_LABEL } from '@/ui/classes';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

// The hint of a menu row (`MENU_HINT`) in the color of the status, which that string would fix to faint.
const STATUS_HINT: Record<ChatSubagentItem['status'], string> = {
    running: 'text-status-running',
    done: 'text-text-faint',
    failed: 'text-status-error'
};

/*
 * The way from the main agent down to the sub-agent on screen, each step a way back up, and a close
 * that goes straight back to the main agent. Nothing while the main agent itself is on screen.
 */
export function SubagentBreadcrumb({ chatId, className }: { chatId: string; className?: string }) {
    const { trail, show } = useSubagentTrail(chatId);
    if (trail.length === 0) {
        return null;
    }
    const steps = breadcrumbOf(trail);
    return (
        <nav aria-label="Sub-agents" className={clsx('flex min-w-0 items-center gap-1 text-xs', className)}>
            {steps.map((step, index) => (
                <Fragment key={step.depth}>
                    {index > 0 && <Icon icon={ChevronRight} size={12} className="shrink-0 text-text-faint" />}
                    {step.current ? (
                        <span aria-current="page" className="min-w-0 truncate text-text">
                            {step.label}
                        </span>
                    ) : (
                        <button
                            type="button"
                            // The main agent keeps its name whole; the sub-agents between it and the one on screen give way.
                            className={clsx('truncate text-text-muted hover:text-text', step.depth === 0 ? 'shrink-0' : 'min-w-0 shrink')}
                            onClick={() => show(trailTo(trail, step.depth))}
                        >
                            {step.label}
                        </button>
                    )}
                </Fragment>
            ))}
            <Tooltip label="Back to the main agent" name>
                <button type="button" className="icon-btn h-7 w-7 shrink-0" onClick={() => show(trailTo(trail, 0))}>
                    <Icon icon={X} size={14} />
                </button>
            </Tooltip>
        </nav>
    );
}

/* The sub-agents of a chat, its CLI's own and the tasks it gave other nodes, to open in the chat's place. */
export function SubagentMenu({ chatId }: { chatId: string }) {
    const subagents = useOpenableSubagents(chatId);
    const { show } = useSubagentTrail(chatId);
    if (subagents.length === 0) {
        return null;
    }
    return (
        <Menu.Root>
            <Tooltip label="Sub-agents" name>
                <Menu.Trigger className="icon-btn h-7 w-7">
                    <Icon icon={Bot} size={16} />
                </Menu.Trigger>
            </Tooltip>
            <Menu.Portal>
                <Menu.Positioner className="z-(--z-popup)" side="bottom" align="end" sideOffset={6}>
                    <Menu.Popup className="menu-popup max-w-96 min-w-60">
                        <div className={MENU_LABEL}>Sub-agents</div>
                        {subagents.map((item) => (
                            <Menu.Item key={item.id} className="menu-item" onClick={() => show(openFromMain(crumbOf(item)))}>
                                {/* A node another agent opened with `--task` reads as the task it is, as its row in the thread does. */}
                                <Icon icon={item.origin === 'ruimte' ? ListChecks : Bot} size={14} />
                                <span className="min-w-0 truncate">{item.description || item.summary || item.subagentType || 'Sub-agent'}</span>
                                <span className={clsx('ml-auto pl-3 text-xs/[inherit]', STATUS_HINT[item.status])}>{item.status}</span>
                            </Menu.Item>
                        ))}
                    </Menu.Popup>
                </Menu.Positioner>
            </Menu.Portal>
        </Menu.Root>
    );
}
