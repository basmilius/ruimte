import type { AgentKind, Plan, PlanItem, PlanSection, PlanStep, PlanStepState, PlanText } from '@ruimte/contracts';
import { allItems, allSteps, isParentStep, planProgress, stepState, type PlanProgress } from '@ruimte/plan';

/* Which steps the panel lists; local to this client, never part of the plan. */
export type PlanFilter = 'all' | 'open' | 'failed';

export interface PlanViewOptions {
    filter: PlanFilter;
    /* Folds every section and parent step whose steps are all done or skipped. */
    collapseDone: boolean;
    /* The sections and parent steps a person folded. */
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
          /* A step under this one is active, so a folded parent still says where the work is. */
          activeBelow: boolean;
      };

const LEAF_MATCHES: Record<Exclude<PlanFilter, 'all'>, ReadonlySet<PlanStepState>> = {
    open: new Set(['open', 'active', 'blocked']),
    failed: new Set(['failed'])
};

const leavesOf = (items: readonly PlanItem[]): PlanStep[] => allSteps(items).filter((step) => !isParentStep(step));

const matches = (items: readonly PlanItem[], filter: PlanFilter): boolean =>
    filter === 'all' || leavesOf(items).some((step) => LEAF_MATCHES[filter].has(step.state ?? 'open'));

const allDone = (items: readonly PlanItem[]): boolean => {
    const leaves = leavesOf(items);
    return leaves.length > 0 && leaves.every((step) => step.state === 'done' || step.state === 'skipped');
};

/* The plan as the rows the panel draws, in document order, with folds and the filter applied. */
export const planRows = (plan: Pick<Plan, 'items'>, options: PlanViewOptions): PlanRow[] => {
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
            activeBelow: parent && leavesOf(item.steps!).some((leaf) => leaf.state === 'active')
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
};

/* Every section and parent step, what "Collapse all" folds. */
export const foldableIds = (plan: Pick<Plan, 'items'>): string[] =>
    allItems(plan.items)
        .filter((item) => item.type === 'section' || (item.type === 'step' && isParentStep(item)))
        .map((item) => item.id);

/* "Plan 6/11": steps with an outcome over all steps, the counter `plan read` uses too. */
export const planCounter = (plan: Pick<Plan, 'items'>): string => {
    const progress = planProgress(plan.items);
    return `${progress.finished}/${progress.total}`;
};

export const hasFailedStep = (plan: Pick<Plan, 'items'>): boolean => leavesOf(plan.items).some((step) => step.state === 'failed');

/* The first active step, which the header names under the status line. */
export const activeStep = (plan: Pick<Plan, 'items'>): PlanStep | null => leavesOf(plan.items).find((step) => step.state === 'active') ?? null;

/* What a state reads as in a plan of this kind: a test is passed, not done. */
export const stateLabel = (kind: Plan['meta']['kind'], state: PlanStepState): string => {
    if (kind === 'test') {
        return {
            open: 'Not run',
            active: 'Running',
            done: 'Passed',
            failed: 'Failed',
            skipped: 'Skipped',
            blocked: 'Blocked',
            warning: 'Warning',
            info: 'Info'
        }[state];
    }
    return { open: 'Open', active: 'Active', done: 'Done', failed: 'Failed', skipped: 'Skipped', blocked: 'Blocked', warning: 'Warning', info: 'Info' }[state];
};

/* The states a person picks from; active is the agent's word for where it works. */
export const PERSON_STATES: readonly PlanStepState[] = ['open', 'done', 'failed', 'skipped', 'blocked'];

/* The four outcomes the mark of a test step offers. */
export const TEST_OUTCOMES: readonly PlanStepState[] = ['done', 'failed', 'skipped', 'blocked'];

/* A click on the mark of a step in a steps plan: done, or back to open. */
export const toggledState = (state: PlanStepState): PlanStepState => (state === 'done' ? 'open' : 'done');

const AGENT_NAMES: Record<string, string> = { claude: 'Claude', codex: 'Codex', gemini: 'Gemini', copilot: 'Copilot' };

/* The short name of the agent a chat runs, as a person calls it. */
export const agentName = (provider: AgentKind | string | null | undefined): string => {
    if (!provider) {
        return 'The agent';
    }
    return AGENT_NAMES[provider] ?? provider.charAt(0).toUpperCase() + provider.slice(1);
};

/*
 * Who set a step and when. A person's short line stays in the row; an agent's name only goes in a
 * tooltip, so a long title keeps the width of the row. An open step says nothing.
 */
export const stepSetBy = (step: Pick<PlanStep, 'by'>, state: PlanStepState, agent: string, when: string): { text: string | null; tooltip: string | null } => {
    if (state === 'open') {
        return { text: null, tooltip: null };
    }
    if (step.by === 'person') {
        return { text: when ? `you · ${when}` : 'you', tooltip: null };
    }
    if (step.by === 'agent') {
        return { text: null, tooltip: when ? `${agent} set it at ${when}` : `${agent} set it` };
    }
    return { text: null, tooltip: null };
};

/*
 * What "Send results to chat" puts in the prompt: every failed and blocked step with its note, under
 * the plan's title. Null when there is nothing to report.
 */
export const resultsText = (plan: Plan): string | null => {
    const lines = (state: PlanStepState): string[] =>
        leavesOf(plan.items)
            .filter((step) => step.state === state)
            .map((step) => `- ${step.title}${step.note ? `: ${step.note.replace(/\s*\n\s*/g, ' ')}` : ''}`);
    const failed = lines('failed');
    const blocked = lines('blocked');
    if (failed.length === 0 && blocked.length === 0) {
        return null;
    }
    const parts = [`Results of the plan "${plan.meta.title}":`];
    if (failed.length > 0) {
        parts.push(['Failed:', ...failed].join('\n'));
    }
    if (blocked.length > 0) {
        parts.push(['Blocked:', ...blocked].join('\n'));
    }
    return parts.join('\n\n');
};

/* One step as a line of Markdown, for Copy in its menu. */
export const stepMarkdown = (kind: Plan['meta']['kind'], step: PlanStep): string => {
    const state = stepState(step);
    const mark = state === 'done' ? '[x]' : '[ ]';
    const label = state === 'open' || state === 'done' ? '' : ` (${stateLabel(kind, state).toLowerCase()})`;
    return `- ${mark} ${step.title}${label}${step.note ? `\n    > ${step.note.replace(/\n/g, '\n    > ')}` : ''}`;
};
