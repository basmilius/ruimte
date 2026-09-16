import { Fragment, type ReactNode } from 'react';
import clsx from 'clsx';
import { Bot, ChevronRight, X } from 'lucide-react';
import { breadcrumbOf, isOnList, MAIN_AGENT, toggleList, trailTo, useOpenableSubagents, useSubagentTrail } from '@/chat/subagent-view';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const CRUMB_LINK = 'truncate text-text-muted hover:text-text';

/*
 * The chat's own title where the bar draws it. While the list or a sub-agent stands in the chat's
 * place it is the first crumb of the way down, so pressing it goes back to the main agent.
 */
export function SubagentTitleCrumb({ chatId, className, children }: { chatId: string; className?: string; children: ReactNode }) {
    const { trail, show } = useSubagentTrail(chatId);
    if (trail.length === 0) {
        return <>{children}</>;
    }
    return (
        <button type="button" className={clsx('flex min-w-0 items-center', className)} onClick={() => show(MAIN_AGENT)}>
            {children}
        </button>
    );
}

/*
 * The way down after the chat's title, each step a way back up, and a close that goes straight back
 * to the main agent. A bar that does not draw the title itself passes it, and it opens the way.
 * Nothing while the main agent itself is on screen.
 */
export function SubagentBreadcrumb({ chatId, title, className }: { chatId: string; title?: string; className?: string }) {
    const { trail, show } = useSubagentTrail(chatId);
    if (trail.length === 0) {
        return null;
    }
    const steps = breadcrumbOf(trail);
    return (
        <nav aria-label="Sub-agents" className={clsx('flex min-w-0 items-center gap-1 text-xs', className)}>
            {title !== undefined && (
                <button type="button" className={clsx(CRUMB_LINK, 'min-w-0 shrink')} onClick={() => show(MAIN_AGENT)}>
                    {title}
                </button>
            )}
            {steps.map((step) => (
                <Fragment key={step.depth}>
                    <Icon icon={ChevronRight} size={12} className="shrink-0 text-text-faint" />
                    {step.current ? (
                        <span aria-current="page" className="min-w-0 truncate text-text">
                            {step.label}
                        </span>
                    ) : (
                        <button
                            type="button"
                            // The list keeps its short name whole; the sub-agents between it and the one on screen give way.
                            className={clsx(CRUMB_LINK, step.kind === 'list' ? 'shrink-0' : 'min-w-0 shrink')}
                            onClick={() => show(trailTo(trail, step.depth))}
                        >
                            {step.label}
                        </button>
                    )}
                </Fragment>
            ))}
            <Tooltip label="Back to the main agent" name>
                <button type="button" className="icon-btn h-7 w-7 shrink-0" onClick={() => show(MAIN_AGENT)}>
                    <Icon icon={X} size={14} />
                </button>
            </Tooltip>
        </nav>
    );
}

/* Puts the list of the chat's sub-agents, its CLI's own and the tasks it gave other nodes, in the chat's place. */
export function SubagentButton({ chatId }: { chatId: string }) {
    const subagents = useOpenableSubagents(chatId);
    const { trail, show } = useSubagentTrail(chatId);
    if (subagents.length === 0) {
        return null;
    }
    return (
        <Tooltip label="Sub-agents" name>
            <button type="button" className="icon-btn h-7 w-7" aria-pressed={isOnList(trail)} onClick={() => show(toggleList(trail))}>
                <Icon icon={Bot} size={16} />
            </button>
        </Tooltip>
    );
}
