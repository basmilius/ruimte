import { Fragment, type ReactNode } from 'react';
import clsx from 'clsx';
import { useTranslation } from 'react-i18next';
import { ChevronRight, X } from 'lucide-react';
import { breadcrumbOf, MAIN_AGENT, trailTo, useOpenableSubagents, useSubagentTrail } from '@/chat/subagent-view';
import { SubagentStopButton } from '@/chat/ui/SubagentStopButton';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

const CRUMB_LINK = 'truncate text-text-muted hover:text-text';

/*
 * The chat's own title where the bar draws it. While a sub-agent stands in the chat's place it is the first crumb of the way down, so pressing it goes back to the main agent.
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
    const { t } = useTranslation('chat');
    const { trail, show } = useSubagentTrail(chatId);
    const subagents = useOpenableSubagents(chatId);
    if (trail.length === 0) {
        return null;
    }
    const steps = breadcrumbOf(trail);
    // Only a row of the chat's own thread can be stopped; a grandchild belongs to the sub-agent that opened it.
    const shown = trail.length === 1 ? subagents.find((item) => item.toolUseId === trail[0]!.toolUseId) : undefined;
    return (
        <nav aria-label={t('subagents.title')} className={clsx('flex min-w-0 items-center gap-1 text-xs', className)}>
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
                        <button type="button" className={clsx(CRUMB_LINK, 'min-w-0 shrink')} onClick={() => show(trailTo(trail, step.depth))}>
                            {step.label}
                        </button>
                    )}
                </Fragment>
            ))}
            {shown !== undefined && <SubagentStopButton chatId={chatId} item={shown} className="h-7 w-7" />}
            <Tooltip label={t('subagents.backToMain')} name>
                <button type="button" className="icon-btn h-7 w-7 shrink-0" onClick={() => show(MAIN_AGENT)}>
                    <Icon icon={X} size={14} />
                </button>
            </Tooltip>
        </nav>
    );
}
