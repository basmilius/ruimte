import type { Plan, PlanItem, PlanStep, PlanStepState } from '@ruimte/contracts';
import { activeStepIds, effectiveChecks, isParentStep, planProgress, stepState, type PlanProgress } from './tree.ts';

export const PLAN_STATE_MARKERS: Record<PlanStepState, string> = {
    open: '[ ]',
    active: '[~]',
    done: '[x]',
    failed: '[!]',
    skipped: '[-]',
    blocked: '[?]'
};

export const PLAN_LEGEND = '[ ] open, [~] active, [x] done, [!] failed, [-] skipped, [?] blocked';

export interface PlanTextOptions {
    /* The chat's other plans, named on the second line. */
    others?: readonly Plan[];
    /* How `at` reads; the default is the local hour and minute. */
    formatTime?: (at: string) => string;
}

const localTime = (at: string): string => {
    const date = new Date(at);
    if (Number.isNaN(date.getTime())) {
        return '';
    }
    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
};

const oneLine = (text: string): string => text.replace(/\s*\n\s*/g, ' ');

const counter = (progress: PlanProgress): string => `${progress.finished}/${progress.total}`;

export const progressText = (plan: Pick<Plan, 'meta' | 'items'>): string => {
    const progress = planProgress(plan.items);
    const extra = (count: number, label: string): string[] => (count > 0 ? [`${count} ${label}`] : []);
    if (plan.meta.kind === 'test') {
        return [
            `${progress.finished} of ${progress.total} run`,
            `${progress.done} passed`,
            ...extra(progress.failed, 'failed'),
            ...extra(progress.skipped, 'skipped'),
            ...extra(progress.blocked, 'blocked')
        ].join(', ');
    }
    return [
        `${progress.done} of ${progress.total} done`,
        ...extra(progress.failed, 'failed'),
        ...extra(progress.skipped, 'skipped'),
        ...extra(progress.blocked, 'blocked')
    ].join(', ');
};

const sentences = (parts: string[]): string => parts.map((part, index) => (index < parts.length - 1 && !/[.!?]$/.test(part) ? `${part}.` : part)).join(' ');

/*
 * The compact text `plan read` prints for an agent: one line per item with its id in brackets, so
 * the ids survive a compacted conversation. The markers are `PLAN_LEGEND`.
 */
export const renderPlanText = (plan: Plan, options: PlanTextOptions = {}): string => {
    const formatTime = options.formatTime ?? localTime;
    const lines = [`Plan "${plan.meta.title}" (${plan.id}, ${plan.meta.kind}, rev ${plan.rev}): ${progressText(plan)}`];
    const second: string[] = [];
    if (plan.meta.status) {
        second.push(`Status: ${plan.meta.status}`);
    }
    const active = activeStepIds(plan);
    if (active.length > 0) {
        second.push(`Now: ${active.join(', ')}`);
    }
    if (options.others && options.others.length > 0) {
        const others = options.others.map((other) => `${other.id} "${other.meta.title}" (${other.meta.kind}, ${counter(planProgress(other.items))})`);
        second.push(`Also in this chat: ${others.join(', ')}`);
    }
    if (second.length > 0) {
        lines.push(sentences(second));
    }

    const stepLine = (step: PlanStep, number: string, indent: string): void => {
        let line = `${indent}${PLAN_STATE_MARKERS[stepState(step)]} ${number} ${step.title} [${step.id}]`;
        if (isParentStep(step)) {
            line += ` ${counter(planProgress(step.steps!))}`;
        } else {
            const notes: string[] = [];
            const checks = effectiveChecks(plan, step);
            if (checks !== 'anyone') {
                notes.push(`${checks}-only`);
            } else if (step.unlocked) {
                notes.push('unlocked');
            }
            if (step.by === 'person' && step.state !== undefined) {
                const time = step.at ? formatTime(step.at) : '';
                notes.push(time ? `set by a person ${time}` : 'set by a person');
            }
            if (notes.length > 0) {
                line += ` ${notes.join(', ')}`;
            }
        }
        if (step.note) {
            line += `: "${oneLine(step.note)}"`;
        }
        lines.push(line);
        step.steps?.forEach((child, index) => stepLine(child, `${number}.${index + 1}`, `${indent}  `));
    };
    const itemLines = (items: readonly PlanItem[], indent: string): void => {
        let number = 0;
        for (const item of items) {
            if (item.type === 'text') {
                lines.push(`${indent}${item.title} [${item.id}]${item.description ? `: ${oneLine(item.description)}` : ''}`);
            } else if (item.type === 'step') {
                number++;
                stepLine(item, String(number), indent);
            }
        }
    };

    let loose: PlanItem[] = [];
    const flushLoose = (): void => {
        if (loose.length > 0) {
            lines.push('');
            itemLines(loose, '');
            loose = [];
        }
    };
    for (const item of plan.items) {
        if (item.type !== 'section') {
            loose.push(item);
            continue;
        }
        flushLoose();
        const progress = planProgress(item.items);
        lines.push('', `## ${item.title} [${item.id}]${progress.total > 0 ? ` ${counter(progress)}` : ''}`);
        itemLines(item.items, '  ');
    }
    flushLoose();
    return lines.join('\n');
};
