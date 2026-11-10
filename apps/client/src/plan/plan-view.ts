import { allItems, isParentStep, leafSteps, planProgress, stepState, type PlanProgress } from '@adecore/plan';
import type { AgentKind, Plan, PlanItem, PlanSection, PlanStep, PlanStepState, PlanText } from '@ruimte/contracts';
import i18next from 'i18next';

/* Which steps the panel lists; local to this client, never part of the plan. */
export type PlanFilter = 'all' | 'open' | 'issues';

export interface PlanViewOptions {
    filter: PlanFilter;
    collapseDone: boolean;
    collapsed: ReadonlySet<string>;
}

export type PlanRow =
    | { type: 'section'; item: PlanSection; collapsed: boolean; progress: PlanProgress }
    | { type: 'text'; item: PlanText; depth: number }
    | {
          type: 'step';
          item: PlanStep;
          depth: number;
          state: PlanStepState;
          /* Only for a step with sub-steps, which shows its count instead of a mark of its own. */
          progress: PlanProgress | null;
          collapsed: boolean;
          activeBelow: boolean;
      };

const LEAF_MATCHES: Record<Exclude<PlanFilter, 'all'>, ReadonlySet<PlanStepState>> = {
    open: new Set(['open', 'active', 'blocked']),
    issues: new Set(['failed', 'blocked', 'warning'])
};

function matches(items: readonly PlanItem[], filter: PlanFilter): boolean {
    return filter === 'all' || leafSteps(items).some((step) => LEAF_MATCHES[filter].has(step.state ?? 'open'));
}

function allDone(items: readonly PlanItem[]): boolean {
    const leaves = leafSteps(items);
    return leaves.length > 0 && leaves.every((step) => step.state === 'done' || step.state === 'skipped');
}

export function planRows(plan: Pick<Plan, 'items'>, options: PlanViewOptions): PlanRow[] {
    const rows: PlanRow[] = [];
    const folded = (item: PlanSection | PlanStep, children: readonly PlanItem[]): boolean =>
        options.collapsed.has(item.id) || (options.collapseDone && allDone(children));

    const step = (item: PlanStep, depth: number): void => {
        if (!matches([item], options.filter)) {
            return;
        }
        const parent = isParentStep(item);
        const collapsed = parent && folded(item, item.steps!);
        rows.push({
            type: 'step',
            item,
            depth,
            state: stepState(item),
            progress: parent ? planProgress(item.steps!) : null,
            collapsed,
            activeBelow: parent && leafSteps(item.steps!).some((leaf) => leaf.state === 'active')
        });
        if (parent && !collapsed) {
            for (const child of item.steps!) {
                step(child, depth + 1);
            }
        }
    };

    const entry = (item: PlanItem): void => {
        if (item.type === 'text') {
            if (options.filter === 'all') {
                rows.push({ type: 'text', item, depth: 0 });
            }
            return;
        }
        if (item.type === 'step') {
            step(item, 0);
            return;
        }
        if (options.filter !== 'all' && !matches(item.items, options.filter)) {
            return;
        }
        const collapsed = folded(item, item.items);
        rows.push({ type: 'section', item, collapsed, progress: planProgress(item.items) });
        if (!collapsed) {
            item.items.forEach(entry);
        }
    };

    plan.items.forEach(entry);
    return rows;
}

export function foldableIds(plan: Pick<Plan, 'items'>): string[] {
    return allItems(plan.items)
        .filter((item) => item.type === 'section' || (item.type === 'step' && isParentStep(item)))
        .map((item) => item.id);
}

/* "Plan 6/11": steps with an outcome over all steps, the counter `plan read` uses too. */
export function planCounter(plan: Pick<Plan, 'items'>): string {
    const progress = planProgress(plan.items);
    return `${progress.finished}/${progress.total}`;
}

export function hasFailedStep(plan: Pick<Plan, 'items'>): boolean {
    return leafSteps(plan.items).some((step) => step.state === 'failed');
}

interface ActiveStep {
    id: string;
    title: string;
}

export function activeSteps(plan: Pick<Plan, 'items'>): ActiveStep[] {
    return leafSteps(plan.items)
        .filter((step) => step.state === 'active')
        .map((step) => ({ id: step.id, title: step.title }));
}

export function sameActiveSteps(left: readonly ActiveStep[], right: readonly ActiveStep[]): boolean {
    return left.length === right.length && left.every((step, i) => step.id === right[i].id && step.title === right[i].title);
}

export function activeStepsLabel(steps: readonly ActiveStep[]): string {
    if (steps.length === 0) {
        return '';
    }
    return steps.length === 1 ? steps[0].title : i18next.t('plan:active.more', { title: steps[0].title, count: steps.length - 1 });
}

export function nextActiveTarget(steps: readonly ActiveStep[], last: string | null): string | null {
    if (steps.length === 0) {
        return null;
    }
    const index = steps.findIndex((step) => step.id === last);
    return steps[(index + 1) % steps.length].id;
}

export function ancestorIds(plan: Pick<Plan, 'items'>, id: string): string[] | null {
    const walk = (items: readonly PlanItem[], path: string[]): string[] | null => {
        for (const item of items) {
            if (item.id === id) {
                return path;
            }
            const children = item.type === 'section' ? item.items : item.type === 'step' ? (item.steps ?? []) : [];
            const found = walk(children, [...path, item.id]);
            if (found !== null) {
                return found;
            }
        }
        return null;
    };
    return walk(plan.items, []);
}

/*
 * The view options that show one step: every fold around it opened, and the filter or Collapse done
 * let go only when they would still hide it, so a person's choice survives whenever it can.
 */
export function revealOptions(plan: Pick<Plan, 'items'>, options: PlanViewOptions, id: string): PlanViewOptions {
    const around = new Set(ancestorIds(plan, id) ?? []);
    const opened: PlanViewOptions = { ...options, collapsed: new Set([...options.collapsed].filter((entry) => !around.has(entry))) };
    const shows = (candidate: PlanViewOptions): boolean => planRows(plan, candidate).some((row) => row.item.id === id);
    const candidates: PlanViewOptions[] = [
        opened,
        { ...opened, filter: 'all' },
        { ...opened, collapseDone: false },
        { ...opened, filter: 'all', collapseDone: false }
    ];
    return candidates.find(shows) ?? candidates[candidates.length - 1];
}

/* What a state reads as in a plan of this kind: a test is passed, not done. */
export function stateLabel(kind: Plan['meta']['kind'], state: PlanStepState): string {
    return i18next.t(`plan:state.${kind}.${state}`);
}

export function toggledState(state: PlanStepState): PlanStepState {
    return state === 'done' ? 'open' : 'done';
}

/* Product names, the same word in every language. */
const AGENT_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', antigravity: 'Antigravity', copilot: 'Copilot', grok: 'Grok' };

export function agentName(provider: AgentKind | string | null | undefined): string {
    if (!provider) {
        return i18next.t('plan:agent.unknown');
    }
    return AGENT_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
}

/*
 * Who set a step and when. A person's short line stays in the row; an agent's name only goes in a
 * tooltip, so a long title keeps the width of the row. An open step says nothing.
 */
export function stepSetBy(step: Pick<PlanStep, 'by'>, state: PlanStepState, agent: string, when: string): { text: string | null; tooltip: string | null } {
    if (state === 'open') {
        return { text: null, tooltip: null };
    }
    if (step.by === 'person') {
        return { text: when ? i18next.t('plan:setBy.personAt', { when }) : i18next.t('plan:setBy.person'), tooltip: null };
    }
    if (step.by === 'agent') {
        return { text: null, tooltip: when ? i18next.t('plan:setBy.agentAt', { agent, when }) : i18next.t('plan:setBy.agent', { agent }) };
    }
    return { text: null, tooltip: null };
}

/*
 * What "Send results to chat" puts in the prompt: every failed, blocked, warning and info step with
 * its note, under the plan's title. Null when there is nothing to report.
 */
export function resultsText(plan: Plan): string | null {
    const lines = (state: PlanStepState): string[] =>
        leafSteps(plan.items)
            .filter((step) => step.state === state)
            .map((step) => `- ${step.title}${step.note ? `: ${step.note.replace(/\s*\n\s*/g, ' ')}` : ''}`);
    const groups = (['failed', 'blocked', 'warning', 'info'] as const)
        .map((state) => ({ heading: `${stateLabel('steps', state)}:`, lines: lines(state) }))
        .filter((group) => group.lines.length > 0);
    if (groups.length === 0) {
        return null;
    }
    return [i18next.t('plan:results.title', { title: plan.meta.title }), ...groups.map((group) => [group.heading, ...group.lines].join('\n'))].join('\n\n');
}

/*
 * The plan header, counted out in words. `progressText` in `@adecore/plan` writes the same numbers
 * for an agent, which reads English whatever the person in front of the screen reads, so the two
 * are separate rather than one with a language argument.
 */
export function progressParts(plan: Pick<Plan, 'meta' | 'items'>): string[] {
    const progress = planProgress(plan.items);
    const extra = (count: number, key: string): string[] => (count > 0 ? [i18next.t(`plan:progress.${key}`, { count })] : []);
    if (plan.meta.kind === 'test') {
        return [
            i18next.t('plan:progress.ranOf', { finished: progress.finished, total: progress.total }),
            i18next.t('plan:progress.passed', { count: progress.done }),
            ...extra(progress.warning, 'warning'),
            ...extra(progress.info, 'info'),
            ...extra(progress.failed, 'failed'),
            ...extra(progress.skipped, 'skipped'),
            ...extra(progress.blocked, 'blocked')
        ];
    }
    // In a steps plan a warning or info is still done; the extras say which of the done steps to read.
    return [
        i18next.t('plan:progress.doneOf', { done: progress.done + progress.warning + progress.info, total: progress.total }),
        ...extra(progress.warning, 'withWarning'),
        ...extra(progress.info, 'withInfo'),
        ...extra(progress.failed, 'failed'),
        ...extra(progress.skipped, 'skipped'),
        ...extra(progress.blocked, 'blocked')
    ];
}
