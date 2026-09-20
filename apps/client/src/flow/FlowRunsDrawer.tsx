import { useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';
import type { FlowContent, FlowRun } from '@ruimte/contracts';
import { FlowRuns } from '@/flow/FlowRuns';
import { MIN_RUNS_HEIGHT, MIN_WORKSHEET_HEIGHT, useRunsDrawer } from '@/flow/runs-drawer';
import type { FlowStateHandle } from '@/flow/use-flow-state';
import { useColumnResize } from '@/shell/useColumnResize';
import { ErrorBoundary } from '@/ui/ErrorBoundary';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

interface FlowRunsDrawerProps {
    content: FlowContent;
    flow: FlowStateHandle;
    /* The run whose steps every card is reading right now, or null for the one going on. */
    picked: string | null;
    onPick(runId: string | null): void;
}

/*
 * What this flow has done, under the worksheet rather than beside it. The graph is the thing and the
 * list is what you pull up to it: a run picked here is read back on the cards themselves, so the
 * question "which way did it go, and why" is answered where it was asked.
 */
export function FlowRunsDrawer({ content, flow, picked, onPick }: FlowRunsDrawerProps) {
    const { t } = useTranslation('flow');
    const height = useRunsDrawer((s) => s.height);
    const drawerRef = useRef<HTMLDivElement>(null);
    const { startResize } = useColumnResize(drawerRef, {
        size: height,
        min: MIN_RUNS_HEIGHT,
        from: 'bottom',
        max: () => window.innerHeight - MIN_WORKSHEET_HEIGHT,
        onSize: (next) => useRunsDrawer.getState().setHeight(next)
    });

    return (
        <div ref={drawerRef} data-flow-chrome className="absolute inset-x-0 bottom-0 z-10 flex flex-col border-t border-border bg-surface" style={{ height }}>
            {/* The line between the worksheet and the drawer is the handle that sizes it. */}
            <div className="absolute inset-x-0 -top-[3px] h-[5px] cursor-row-resize" onPointerDown={startResize} />
            <header className="flex h-9 shrink-0 items-center gap-2 border-b border-border-soft pr-1 pl-3">
                <span className="min-w-0 grow truncate text-xs font-medium text-text-muted">{t('runs.title')}</span>
                {picked !== null && (
                    <button type="button" className="rounded-md px-2 py-0.5 text-xs/[inherit] text-text-muted hover:text-text" onClick={() => onPick(null)}>
                        {t('runs.stopReading')}
                    </button>
                )}
                <Tooltip label={t('runs.close')} name>
                    <button type="button" className="icon-btn shrink-0" onClick={() => useRunsDrawer.getState().setOpen(false)}>
                        <Icon icon={X} size={16} />
                    </button>
                </Tooltip>
            </header>
            <div className="min-h-0 grow overflow-y-auto">
                <ErrorBoundary label={t('runs.failed')} resetKeys={[flow.runs.length]} className="min-h-full">
                    <FlowRuns
                        content={content}
                        runs={flow.runs}
                        picked={picked}
                        onPick={onPick}
                        onRunAgain={(run: FlowRun) => void flow.test({ from: run.trigger as string, scope: 'graph', dry: true, tokens: run.tokens })}
                    />
                </ErrorBoundary>
            </div>
        </div>
    );
}
