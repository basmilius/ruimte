import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import clsx from 'clsx';
import { ChevronDown, ChevronRight, RotateCcw } from 'lucide-react';
import type { FlowContent, FlowRun, FlowRunStep } from '@ruimte/contracts';
import { formatDuration } from '@/format/duration';
import { formatMoment } from '@/format/datetime';
import { useFormatLocale } from '@/format/locale';
import { cardLabel } from '@/flow/labels';
import { Icon } from '@/ui/Icon';
import { Tooltip } from '@/ui/Tooltip';

/* What the badge of a run is drawn in. A run that did nothing is not a failure, so it stays quiet. */
const OUTCOME_TONE: Record<FlowRun['outcome'], string> = {
    running: 'text-accent',
    done: 'text-positive-text',
    refused: 'text-status-error',
    skipped: 'text-text-muted',
    missed: 'text-text-muted'
};

interface FlowRunsProps {
    content: FlowContent;
    runs: readonly FlowRun[];
    /* Runs this one again with exactly the values it had, which is the loop a person debugs in. */
    onRunAgain(run: FlowRun): void;
}

/*
 * What every run of this flow did, newest first. Everyone who has ever built an automation knows the
 * moment: it did nothing, and you have no idea why. Did the trigger fire, was a condition false,
 * which one, on what value. This is the answer to that, and it is why the timeline was on disk from
 * the first version rather than waiting for a screen.
 */
export function FlowRuns({ content, runs, onRunAgain }: FlowRunsProps) {
    const { t } = useTranslation('flow');
    const [openRun, setOpenRun] = useState<string | null>(null);
    // The words a time is written in follow the region, which a person may change while this is up.
    useFormatLocale();

    if (runs.length === 0) {
        return <p className="p-3 text-sm text-text-muted">{t('runs.empty')}</p>;
    }

    return (
        <ul className="flex flex-col">
            {runs.map((run) => {
                const open = openRun === run.id;
                const label = run.trigger === undefined ? t('runs.noTrigger') : (nameOf(t, content, run.trigger) ?? t('runs.goneCard'));
                return (
                    <li key={run.id} className="border-b border-border last:border-b-0">
                        <div className="flex items-center gap-1 pr-2">
                            <button
                                type="button"
                                className="flex min-w-0 grow items-center gap-2 px-2 py-2 text-left hover:bg-surface-hover"
                                aria-expanded={open}
                                onClick={() => setOpenRun(open ? null : run.id)}
                            >
                                <Icon icon={open ? ChevronDown : ChevronRight} size={14} className="shrink-0 text-text-faint" />
                                <span className="min-w-0 grow">
                                    <span className="flex items-center gap-1.5">
                                        <span className="truncate text-sm text-text">{label}</span>
                                        {run.test !== undefined && <Tag>{t('runs.test')}</Tag>}
                                        {run.dry === true && <Tag>{t('runs.dry')}</Tag>}
                                    </span>
                                    <span className="flex items-center gap-1.5 text-xs/[inherit] text-text-faint">
                                        <span>{formatMoment(run.startedAt)}</span>
                                        {run.endedAt !== undefined && <span>{formatDuration(run.endedAt - run.startedAt)}</span>}
                                    </span>
                                </span>
                                <span className={clsx('shrink-0 text-xs/[inherit]', OUTCOME_TONE[run.outcome])}>{t(`runs.outcome.${run.outcome}`)}</span>
                            </button>
                            {run.trigger !== undefined && (
                                <Tooltip label={t('runs.again')} name>
                                    <button type="button" className="icon-btn shrink-0" onClick={() => onRunAgain(run)}>
                                        <Icon icon={RotateCcw} size={14} />
                                    </button>
                                </Tooltip>
                            )}
                        </div>
                        {open && (
                            <div className="flex flex-col gap-1.5 px-3 pb-3 pl-8">
                                {run.note !== undefined && <p className="text-xs/[inherit] text-text-muted">{run.note}</p>}
                                {run.test !== undefined && (
                                    <p className="text-xs/[inherit] text-text-faint">
                                        {t(`runs.startedFrom.${run.test.scope}`, { card: nameOf(t, content, run.test.from) ?? t('runs.goneCard') })}
                                    </p>
                                )}
                                {run.steps.length === 0 && run.note === undefined && <p className="text-xs/[inherit] text-text-muted">{t('runs.noSteps')}</p>}
                                {run.steps.map((step, index) => (
                                    <StepLine key={`${step.cardId}-${index}`} content={content} step={step} />
                                ))}
                            </div>
                        )}
                    </li>
                );
            })}
        </ul>
    );
}

function StepLine({ content, step }: { content: FlowContent; step: FlowRunStep }) {
    const { t } = useTranslation('flow');
    return (
        <div className="flex flex-col gap-0.5">
            <div className="flex items-center gap-1.5">
                <span className="min-w-0 truncate text-xs/[inherit] text-text">{nameOf(t, content, step.cardId) ?? t('runs.goneCard')}</span>
                {step.port !== undefined && <span className="shrink-0 text-xs/[inherit] text-text-faint">{t(`ports.${step.port}`)}</span>}
                {/* A branch that reaches a port nobody drew from stops there, and that is not a failure. */}
                {step.port === undefined && <span className="shrink-0 text-xs/[inherit] text-text-faint">{t('runs.wentNowhere')}</span>}
                {step.dry === true && <Tag>{t('runs.dry')}</Tag>}
            </div>
            {step.note !== undefined && <p className="pl-0 text-xs/[inherit] break-words text-text-muted">{step.note}</p>}
        </div>
    );
}

function Tag({ children }: { children: string }) {
    return <span className="shrink-0 rounded-full bg-surface-sunken px-1.5 text-xs/[inherit] text-text-muted">{children}</span>;
}

/* The words of a card that may have been taken off the worksheet since the run it was part of. */
const nameOf = (t: ReturnType<typeof useTranslation<'flow'>>['t'], content: FlowContent, cardId: string): string | null => {
    const card = content.cards[cardId];
    return card === undefined ? null : cardLabel(t, card);
};
